import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import {
  ERROR_CODES,
  type CreateDatabaseBackupRequest,
  type DatabaseBackup,
  type DatabaseBackupsResponse,
} from '@insforge/shared-schemas';
import { AppError, isPgErrorLike } from '@/utils/errors.js';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { appConfig } from '@/infra/config/app.config.js';
import { S3StorageProvider } from '@/providers/storage/s3.provider.js';
import logger from '@/utils/logger.js';

// Internal artifact bucket, mirroring the `_deployments` convention. With S3
// configured the archive lands under `<appKey>/_database_backups/<key>`;
// otherwise it is written to `<STORAGE_DIR>/_database_backups/<key>`.
const BACKUP_BUCKET = '_database_backups';
const MAX_STDERR_LENGTH = 4000;

const BACKUP_COLUMNS = `
  id,
  name,
  trigger_source AS "triggerSource",
  status,
  size_bytes::float8 AS "sizeBytes",
  error_message AS "errorMessage",
  created_at AS "createdAt",
  completed_at AS "completedAt",
  created_by AS "createdBy"
`;

interface BackupRow extends DatabaseBackup {
  storageKey?: string | null;
}

function toIsoString(value: unknown): string | null {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return typeof value === 'string' ? value : null;
}

function serializeBackup(row: BackupRow): DatabaseBackup {
  return {
    id: row.id,
    name: row.name,
    triggerSource: row.triggerSource,
    status: row.status,
    sizeBytes: row.sizeBytes,
    errorMessage: row.errorMessage,
    createdAt: toIsoString(row.createdAt) ?? row.createdAt,
    completedAt: toIsoString(row.completedAt),
    createdBy: row.createdBy,
  };
}

export class DatabaseBackupService {
  private static instance: DatabaseBackupService;
  private dbManager = DatabaseManager.getInstance();
  private s3Provider: S3StorageProvider | null = null;
  private activeBackupId: string | null = null;
  // Reserved synchronously before the first await in createBackup so two
  // overlapping requests cannot both pass the concurrency guard.
  private backupInFlight = false;
  private restoreInProgress = false;

  private constructor() {
    if (appConfig.storage.s3Bucket) {
      this.s3Provider = new S3StorageProvider(
        appConfig.storage.s3Bucket,
        appConfig.storage.appKey,
        appConfig.storage.awsRegion
      );
      void this.s3Provider.initialize();
    }
  }

  public static getInstance(): DatabaseBackupService {
    if (!DatabaseBackupService.instance) {
      DatabaseBackupService.instance = new DatabaseBackupService();
    }
    return DatabaseBackupService.instance;
  }

  async listBackups(): Promise<DatabaseBackupsResponse> {
    await this.failInterruptedBackups();

    const result = await this.dbManager.getPool().query(`
      SELECT ${BACKUP_COLUMNS}
      FROM system.database_backups
      ORDER BY created_at DESC
    `);

    return { backups: (result.rows as BackupRow[]).map(serializeBackup) };
  }

  async createBackup(
    input: CreateDatabaseBackupRequest,
    createdBy: string | null
  ): Promise<DatabaseBackup> {
    this.assertNoRestoreInProgress();
    if (this.backupInFlight) {
      throw new AppError(
        'Another backup is already running. Try again once it finishes.',
        409,
        ERROR_CODES.DATABASE_CONSTRAINT_VIOLATION
      );
    }
    this.backupInFlight = true;

    let row: BackupRow;
    try {
      const result = await this.dbManager.getPool().query(
        `
          INSERT INTO system.database_backups (name, trigger_source, status, created_by)
          VALUES ($1, 'manual', 'running', $2)
          RETURNING ${BACKUP_COLUMNS}
        `,
        [input.name ?? null, createdBy]
      );
      row = result.rows[0] as BackupRow;
    } catch (error) {
      this.backupInFlight = false;
      if (isPgErrorLike(error) && error.code === '23505') {
        throw new AppError(
          'A backup with this name already exists.',
          409,
          ERROR_CODES.DATABASE_DUPLICATE
        );
      }
      throw error;
    }

    this.activeBackupId = row.id;
    void this.runBackup(row.id)
      .catch((error: unknown) => {
        logger.error('Database backup failed', {
          backupId: row.id,
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        this.activeBackupId = null;
        this.backupInFlight = false;
      });

    return serializeBackup(row);
  }

  async renameBackup(id: string, name: string | null): Promise<DatabaseBackup> {
    this.assertNoRestoreInProgress();
    try {
      const result = await this.dbManager.getPool().query(
        `
          UPDATE system.database_backups
          SET name = $2
          WHERE id = $1
          RETURNING ${BACKUP_COLUMNS}
        `,
        [id, name]
      );

      if (result.rows.length === 0) {
        throw new AppError('Backup not found.', 404, ERROR_CODES.DATABASE_NOT_FOUND);
      }

      return serializeBackup(result.rows[0] as BackupRow);
    } catch (error) {
      if (isPgErrorLike(error) && error.code === '23505') {
        throw new AppError(
          'A backup with this name already exists.',
          409,
          ERROR_CODES.DATABASE_DUPLICATE
        );
      }
      throw error;
    }
  }

  async deleteBackup(id: string): Promise<void> {
    this.assertNoRestoreInProgress();
    const backup = await this.getBackupRow(id);

    if (backup.status === 'running' && backup.id === this.activeBackupId) {
      throw new AppError(
        'This backup is still running and cannot be deleted yet.',
        409,
        ERROR_CODES.DATABASE_CONSTRAINT_VIOLATION
      );
    }

    // Remove the row first: a leaked artifact (logged below) is preferable to
    // a row that survives an artifact delete and points at a missing file.
    await this.dbManager.getPool().query(`DELETE FROM system.database_backups WHERE id = $1`, [id]);

    if (backup.storageKey) {
      try {
        await this.deleteArtifact(backup.storageKey);
      } catch (error) {
        logger.warn('Failed to delete backup artifact', {
          backupId: id,
          storageKey: backup.storageKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Restores the database from a completed backup archive.
   *
   * The dump contains every schema, including system.database_backups itself,
   * so the current metadata rows are snapshotted first and written back after
   * the restore — otherwise restoring an old backup would resurrect deleted
   * backups and drop newer ones while their archives still exist.
   *
   * pg_restore runs with --single-transaction so a failed restore rolls back
   * and leaves the database untouched.
   */
  async restoreBackup(id: string): Promise<void> {
    if (this.restoreInProgress) {
      throw new AppError(
        'Another restore is already in progress.',
        409,
        ERROR_CODES.DATABASE_CONSTRAINT_VIOLATION
      );
    }
    if (this.backupInFlight) {
      throw new AppError(
        'A backup is currently running. Try again once it finishes.',
        409,
        ERROR_CODES.DATABASE_CONSTRAINT_VIOLATION
      );
    }

    // Reserve synchronously, before any await, so two overlapping restore
    // requests cannot both pass the guards above.
    this.restoreInProgress = true;
    try {
      const backup = await this.getBackupRow(id);
      if (backup.status !== 'completed' || !backup.storageKey) {
        throw new AppError(
          'This backup is not restorable. Only completed backups can be restored.',
          409,
          ERROR_CODES.DATABASE_CONSTRAINT_VIOLATION
        );
      }

      const pool = this.dbManager.getPool();
      const snapshot = await pool.query(
        `SELECT id, name, trigger_source, status, storage_key, size_bytes,
                error_message, created_by, completed_at, created_at, updated_at
         FROM system.database_backups`
      );

      // Do NOT pg_terminate_backend other sessions here: that kills the
      // backend's own long-lived clients (realtime LISTEN, pool) and crashes
      // the process. Idle connections hold no table locks, so pg_restore can
      // acquire what it needs; if something does hold a lock, the
      // single-transaction restore fails and rolls back instead.
      const artifact = await this.openArtifactStream(backup.storageKey);
      await this.runPgTool(
        'pg_restore',
        ['--clean', '--if-exists', '--single-transaction', '-d', appConfig.database.name],
        artifact
      );

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('TRUNCATE system.database_backups');
        for (const row of snapshot.rows as Record<string, unknown>[]) {
          await client.query(
            `INSERT INTO system.database_backups
               (id, name, trigger_source, status, storage_key, size_bytes,
                error_message, created_by, completed_at, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
              row.id,
              row.name,
              row.trigger_source,
              row.status,
              row.storage_key,
              row.size_bytes,
              row.error_message,
              row.created_by,
              row.completed_at,
              row.created_at,
              row.updated_at,
            ]
          );
        }
        await client.query(`NOTIFY pgrst, 'reload schema';`);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }

      DatabaseManager.clearColumnTypeCache();
      logger.info('Database restore completed', { backupId: id });
    } finally {
      this.restoreInProgress = false;
    }
  }

  private async runBackup(id: string): Promise<void> {
    // Suffix with the backup id: the timestamp alone has second resolution,
    // so two quick successive backups would otherwise share a key and the
    // second archive would overwrite the first.
    const storageKey = `${formatTimestamp(new Date())}_${id}.dump`;
    const tmpDir = await fs.mkdtemp(path.join(appConfig.storage.storageDir, '.backup-tmp-'));
    const tmpPath = path.join(tmpDir, storageKey);

    try {
      const out = createWriteStream(tmpPath);
      await this.runPgTool(
        'pg_dump',
        ['--format=custom', '-d', appConfig.database.name],
        undefined,
        out
      );

      const { size } = await fs.stat(tmpPath);
      await this.persistArtifact(tmpPath, storageKey, size);

      await this.dbManager.getPool().query(
        `
          UPDATE system.database_backups
          SET status = 'completed', storage_key = $2, size_bytes = $3, completed_at = NOW()
          WHERE id = $1
        `,
        [id, storageKey, size]
      );
      logger.info('Database backup completed', { backupId: id, storageKey, sizeBytes: size });
    } catch (error) {
      // A failed row never gets a storage_key, so an artifact persisted just
      // before a late failure (e.g. the completed-status update) would be
      // orphaned — remove it best-effort.
      await this.deleteArtifact(storageKey).catch(() => {});

      const message = error instanceof Error ? error.message : String(error);
      await this.dbManager
        .getPool()
        .query(
          `UPDATE system.database_backups
           SET status = 'failed', error_message = $2
           WHERE id = $1`,
          [id, message.slice(0, MAX_STDERR_LENGTH)]
        )
        .catch(() => {});
      throw error;
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  private runPgTool(
    tool: 'pg_dump' | 'pg_restore',
    extraArgs: string[],
    stdin?: Readable,
    stdout?: NodeJS.WritableStream
  ): Promise<void> {
    const { host, port, user, password } = appConfig.database;
    const args = ['-h', host, '-p', String(port), '-U', user, '--no-password', ...extraArgs];

    return new Promise((resolve, reject) => {
      const child = spawn(tool, args, {
        env: { ...process.env, PGPASSWORD: password },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => {
        if (stderr.length < MAX_STDERR_LENGTH) {
          stderr += chunk.toString();
        }
      });

      child.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
          reject(
            new AppError(
              `${tool} is not available in the backend environment. Install the PostgreSQL client tools to enable database backups.`,
              500,
              ERROR_CODES.DATABASE_INTERNAL_ERROR
            )
          );
          return;
        }
        reject(error);
      });

      // Settle only after the process exits AND every pipe has flushed, so a
      // resolved promise guarantees the output stream is fully written. Pipe
      // failures are captured (not awaited) so a spawn failure — where 'close'
      // never fires — cannot leave an unhandled rejection.
      let exited = false;
      let exitCode: number | null = null;
      let pendingPipes = 0;
      let pipeError: unknown = null;

      const settle = () => {
        if (!exited || pendingPipes > 0) {
          return;
        }
        if (exitCode !== 0) {
          reject(
            new AppError(
              `${tool} exited with code ${exitCode ?? 'unknown'}: ${stderr.trim().slice(0, MAX_STDERR_LENGTH)}`,
              500,
              ERROR_CODES.DATABASE_INTERNAL_ERROR
            )
          );
          return;
        }
        if (pipeError) {
          reject(pipeError instanceof Error ? pipeError : new Error(String(pipeError)));
          return;
        }
        resolve();
      };

      const trackPipe = (pipe: Promise<void>) => {
        pendingPipes += 1;
        pipe
          .catch((error: unknown) => {
            pipeError = pipeError ?? error;
          })
          .finally(() => {
            pendingPipes -= 1;
            settle();
          });
      };

      if (stdin) {
        trackPipe(pipeline(stdin, child.stdin));
      } else {
        child.stdin.end();
      }
      if (stdout) {
        trackPipe(pipeline(child.stdout, stdout));
      } else {
        child.stdout.resume();
      }

      child.on('close', (code) => {
        exited = true;
        exitCode = code;
        settle();
      });
    });
  }

  /**
   * Mutating backup metadata while a restore is running would be clobbered
   * (or, for deletes, resurrected) by the post-restore snapshot write-back.
   */
  private assertNoRestoreInProgress(): void {
    if (this.restoreInProgress) {
      throw new AppError(
        'A restore is currently in progress. Try again once it finishes.',
        409,
        ERROR_CODES.DATABASE_CONSTRAINT_VIOLATION
      );
    }
  }

  private async getBackupRow(id: string): Promise<BackupRow> {
    const result = await this.dbManager.getPool().query(
      `
        SELECT ${BACKUP_COLUMNS}, storage_key AS "storageKey"
        FROM system.database_backups
        WHERE id = $1
      `,
      [id]
    );

    if (result.rows.length === 0) {
      throw new AppError('Backup not found.', 404, ERROR_CODES.DATABASE_NOT_FOUND);
    }

    return result.rows[0] as BackupRow;
  }

  /**
   * Backups left in 'running' state with no in-memory operation were
   * interrupted by a server restart; surface them as failed.
   */
  private async failInterruptedBackups(): Promise<void> {
    await this.dbManager.getPool().query(
      `
        UPDATE system.database_backups
        SET status = 'failed', error_message = 'Interrupted by a server restart.'
        WHERE status = 'running' AND id IS DISTINCT FROM $1
      `,
      [this.activeBackupId]
    );
  }

  private localArtifactPath(key: string): string {
    return path.join(appConfig.storage.storageDir, BACKUP_BUCKET, key);
  }

  private async persistArtifact(tmpPath: string, key: string, size: number): Promise<void> {
    if (this.s3Provider) {
      await this.s3Provider.putObjectStream(BACKUP_BUCKET, key, createReadStream(tmpPath), {
        contentType: 'application/octet-stream',
        contentLength: size,
      });
      return;
    }

    const target = this.localArtifactPath(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    // The temp dir lives on the same volume as STORAGE_DIR, so rename is atomic.
    await fs.rename(tmpPath, target);
  }

  private async openArtifactStream(key: string): Promise<Readable> {
    if (this.s3Provider) {
      const result = await this.s3Provider.getObjectStream(BACKUP_BUCKET, key);
      return result.body;
    }
    return createReadStream(this.localArtifactPath(key));
  }

  private async deleteArtifact(key: string): Promise<void> {
    if (this.s3Provider) {
      await this.s3Provider.deleteObject(BACKUP_BUCKET, key);
      return;
    }
    await fs.rm(this.localArtifactPath(key), { force: true });
  }
}

function formatTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `_${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
  );
}
