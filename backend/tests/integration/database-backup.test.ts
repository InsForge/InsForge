import { describe, beforeAll, afterAll, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getConnections } from './utils';

/**
 * End-to-end backup round-trip against a real migrated database, using the
 * real pg_dump/pg_restore binaries (installed in CI by integration-tests.yml).
 *
 * The service reads connection and storage settings from the environment at
 * module load, so env is pointed at the isolated pgsql-test database and a
 * temp STORAGE_DIR before the service modules are dynamically imported.
 */

type BackupService =
  typeof import('../../src/services/database/database-backup.service').DatabaseBackupService;
type ManagerModule = typeof import('../../src/infra/database/database.manager').DatabaseManager;

let teardown: (() => Promise<void>) | undefined;
let svc: InstanceType<BackupService>;
let dbManager: InstanceType<ManagerModule>;
let storageDir: string;

interface BackupStateRow {
  status: string;
  errorMessage: string | null;
  storageKey: string | null;
}

async function readBackupRow(id: string): Promise<BackupStateRow> {
  const result = await dbManager.getPool().query(
    `SELECT status, error_message AS "errorMessage", storage_key AS "storageKey"
     FROM system.database_backups WHERE id = $1`,
    [id]
  );
  return result.rows[0] as BackupStateRow;
}

async function waitForBackupCompletion(id: string): Promise<BackupStateRow> {
  let row = await readBackupRow(id);
  for (let i = 0; i < 90 && row.status === 'running'; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    row = await readBackupRow(id);
  }
  return row;
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('waitFor timed out');
}

beforeAll(async () => {
  const conn = await getConnections();
  teardown = conn.teardown;
  const cfg = conn.pg.config;

  storageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'insforge-backup-int-'));
  process.env.STORAGE_DIR = storageDir;
  process.env.POSTGRES_HOST = String(cfg.host ?? 'localhost');
  process.env.POSTGRES_PORT = String(cfg.port ?? 5432);
  process.env.POSTGRES_DB = String(cfg.database);
  process.env.POSTGRES_USER = String(cfg.user ?? 'postgres');
  process.env.POSTGRES_PASSWORD = String(cfg.password ?? 'postgres');
  // Exercise the local-disk artifact path; the S3 branch shares the same
  // provider contract and is covered by the storage provider suites.
  // (AWS_S3_BUCKET is the legacy fallback for S3_BUCKET — clear both.)
  delete process.env.S3_BUCKET;
  delete process.env.AWS_S3_BUCKET;

  const { DatabaseManager } = await import('../../src/infra/database/database.manager');
  const { DatabaseBackupService } =
    await import('../../src/services/database/database-backup.service');
  dbManager = DatabaseManager.getInstance();
  await dbManager.initialize();
  svc = DatabaseBackupService.getInstance();
}, 120_000);

afterAll(async () => {
  // Close the service pool before teardown so DROP DATABASE is not blocked.
  await dbManager?.close();
  await teardown?.();
  if (storageDir) {
    await fs.rm(storageDir, { recursive: true, force: true });
  }
});

describe('backup schedule config', () => {
  it('seeds disabled defaults and computes nextBackupAt only when enabled', async () => {
    const defaults = await svc.getBackupConfig();
    expect(defaults).toEqual({
      enabled: false,
      cronSchedule: '0 0 * * *',
      retentionDays: 7,
      nextBackupAt: null,
    });

    const updated = await svc.updateBackupConfig({
      enabled: true,
      cronSchedule: '30 2 * * *',
      retentionDays: 14,
    });
    expect(updated).toMatchObject({ enabled: true, cronSchedule: '30 2 * * *', retentionDays: 14 });
    expect(updated.nextBackupAt).toBeTruthy();

    const disabled = await svc.updateBackupConfig({ enabled: false });
    // Partial update: the other fields survive untouched.
    expect(disabled).toMatchObject({ cronSchedule: '30 2 * * *', retentionDays: 14 });
    expect(disabled.nextBackupAt).toBeNull();
  });

  it('rejects sub-hour and malformed cron expressions', async () => {
    await expect(svc.updateBackupConfig({ cronSchedule: '*/30 * * * *' })).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(svc.updateBackupConfig({ cronSchedule: 'not a cron' })).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});

describe('backup round-trip', () => {
  it('creates a backup, restores it from the artifact, and deletes the artifact', async () => {
    const pool = dbManager.getPool();
    await pool.query(`CREATE TABLE backup_probe (id INT PRIMARY KEY, v TEXT)`);
    await pool.query(`INSERT INTO backup_probe VALUES (1, 'before')`);

    const backup = await svc.createBackup({ name: 'integration-roundtrip' }, 'integration-test');
    const completed = await waitForBackupCompletion(backup.id);
    expect(completed.errorMessage).toBeNull();
    expect(completed.status).toBe('completed');

    const artifactPath = path.join(storageDir, '_database_backups', completed.storageKey as string);
    const artifact = await fs.stat(artifactPath);
    expect(artifact.size).toBeGreaterThan(0);

    // The restore must revert data changed after the backup was taken, but
    // must NOT revert the backup schedule config changed after the backup —
    // the config write-back preserves the operator's current settings.
    await pool.query(`UPDATE backup_probe SET v = 'after' WHERE id = 1`);
    await svc.updateBackupConfig({ retentionDays: 21 });
    await svc.restoreBackup(backup.id);
    const probe = await pool.query(`SELECT v FROM backup_probe WHERE id = 1`);
    expect(probe.rows[0].v).toBe('before');
    expect((await svc.getBackupConfig()).retentionDays).toBe(21);

    await svc.deleteBackup(backup.id);
    await expect(fs.stat(artifactPath)).rejects.toMatchObject({ code: 'ENOENT' });
  }, 180_000);
});

describe('scheduled backup retention', () => {
  it('prunes expired scheduled backups after a scheduled run completes', async () => {
    const pool = dbManager.getPool();
    await svc.updateBackupConfig({ enabled: true, cronSchedule: '0 0 * * *', retentionDays: 7 });

    const staleKey = 'stale_expired.dump';
    const staleArtifact = path.join(storageDir, '_database_backups', staleKey);
    await fs.mkdir(path.dirname(staleArtifact), { recursive: true });
    await fs.writeFile(staleArtifact, 'stale-bytes');
    await pool.query(
      `INSERT INTO system.database_backups
           (name, trigger_source, status, storage_key, size_bytes, completed_at, created_at)
         VALUES ('expired-scheduled', 'scheduled', 'completed', $1, 11,
                 NOW() - INTERVAL '10 days', NOW() - INTERVAL '10 days')`,
      [staleKey]
    );

    const backup = await svc.createBackup({}, null, 'scheduled');
    const completed = await waitForBackupCompletion(backup.id);
    expect(completed.status).toBe('completed');

    // Pruning runs right after the scheduled run completes.
    await waitFor(async () => {
      const result = await pool.query(
        `SELECT COUNT(*)::int AS count FROM system.database_backups WHERE name = 'expired-scheduled'`
      );
      return (result.rows[0] as { count: number }).count === 0;
    });
    await expect(fs.stat(staleArtifact)).rejects.toMatchObject({ code: 'ENOENT' });

    // The fresh scheduled backup itself is retained, and the list surfaces
    // when retention will delete it; manual backups never expire.
    const fresh = await readBackupRow(backup.id);
    expect(fresh.status).toBe('completed');
    const listed = (await svc.listBackups()).backups;
    const scheduledRow = listed.find((b) => b.id === backup.id);
    expect(scheduledRow?.expiresAt).toBeTruthy();
    expect(
      listed.filter((b) => b.triggerSource === 'manual').every((b) => b.expiresAt === null)
    ).toBe(true);

    await svc.deleteBackup(backup.id);
    await svc.updateBackupConfig({ enabled: false });
  }, 180_000);
});
