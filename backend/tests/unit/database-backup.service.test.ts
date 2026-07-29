import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ERROR_CODES } from '@insforge/shared-schemas';

const STORAGE_DIR = '/tmp/insforge-backup-service-tests';

const {
  queryMock,
  connectMock,
  clientQueryMock,
  releaseMock,
  spawnMock,
  clearColumnTypeCacheMock,
} = vi.hoisted(() => ({
  queryMock: vi.fn(),
  connectMock: vi.fn(),
  clientQueryMock: vi.fn(),
  releaseMock: vi.fn(),
  spawnMock: vi.fn(),
  clearColumnTypeCacheMock: vi.fn(),
}));

vi.mock('../../src/infra/database/database.manager', () => ({
  DatabaseManager: {
    getInstance: vi.fn(() => ({
      getPool: vi.fn(() => ({
        query: queryMock,
        connect: connectMock,
      })),
    })),
    clearColumnTypeCache: clearColumnTypeCacheMock,
  },
}));

vi.mock('../../src/infra/config/app.config', () => ({
  appConfig: {
    storage: {
      s3Bucket: undefined,
      appKey: 'local',
      s3Region: 'us-east-2',
      storageDir: '/tmp/insforge-backup-service-tests',
    },
    database: {
      host: 'localhost',
      port: 5432,
      name: 'insforge',
      user: 'postgres',
      password: 'postgres',
    },
  },
}));

vi.mock('../../src/providers/storage/s3.provider', () => ({
  S3StorageProvider: vi.fn(),
}));

const { loggerMock } = vi.hoisted(() => ({
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/utils/logger', () => ({ default: loggerMock, logger: loggerMock }));

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

import { DatabaseBackupService } from '../../src/services/database/database-backup.service';

interface FakeChildOptions {
  exitCode?: number;
  stdoutData?: Buffer | null;
  stderrData?: string;
  autoClose?: boolean;
}

function makeFakeChild(options: FakeChildOptions = {}) {
  const { exitCode = 0, stdoutData = Buffer.from('dump-bytes'), stderrData = '' } = options;
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    stdin: Writable;
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });

  const finish = () => {
    if (stderrData) {
      child.stderr.write(stderrData);
    }
    child.stderr.end();
    if (stdoutData) {
      child.stdout.write(stdoutData);
    }
    child.stdout.end();
    setImmediate(() => child.emit('close', exitCode));
  };

  if (options.autoClose !== false) {
    setImmediate(finish);
  }

  return { child, finish };
}

async function waitForIdle(service: DatabaseBackupService) {
  await vi.waitFor(() => {
    expect((service as unknown as { activeBackupId: string | null }).activeBackupId).toBeNull();
  });
}

function backupRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    name: null,
    triggerSource: 'manual',
    status: 'running',
    sizeBytes: null,
    errorMessage: null,
    createdAt: new Date('2026-06-10T00:00:00Z'),
    completedAt: null,
    createdBy: 'admin',
    ...overrides,
  };
}

describe('DatabaseBackupService', () => {
  beforeAll(async () => {
    await fs.mkdir(STORAGE_DIR, { recursive: true });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    connectMock.mockResolvedValue({ query: clientQueryMock, release: releaseMock });
    clientQueryMock.mockResolvedValue({ rows: [] });
  });

  describe('listBackups', () => {
    it('sweeps orphaned backup temp dirs when no backup is in flight', async () => {
      const orphanDir = path.join(STORAGE_DIR, '.backup-tmp-orphan');
      await fs.mkdir(orphanDir, { recursive: true });

      queryMock.mockResolvedValue({ rows: [] });
      const service = DatabaseBackupService.getInstance();
      await service.listBackups();

      await expect(fs.stat(orphanDir)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('never sweeps temp dirs while a backup is in flight', async () => {
      const liveDir = path.join(STORAGE_DIR, '.backup-tmp-live');
      await fs.mkdir(liveDir, { recursive: true });

      queryMock.mockImplementation((sql: string) => {
        if (sql.includes('INSERT INTO system.database_backups')) {
          return Promise.resolve({ rows: [backupRow()] });
        }
        return Promise.resolve({ rows: [] });
      });
      const pending = makeFakeChild({ autoClose: false });
      spawnMock.mockImplementation(() => pending.child);

      const service = DatabaseBackupService.getInstance();
      await service.createBackup({}, 'admin');

      await service.listBackups();
      await expect(fs.stat(liveDir)).resolves.toBeTruthy();

      await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());
      pending.finish();
      await waitForIdle(service);
      await fs.rm(liveDir, { recursive: true, force: true });
    });

    it('fails interrupted running rows, then returns serialized backups', async () => {
      queryMock.mockImplementation((sql: string) => {
        if (sql.includes("SET status = 'failed'")) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({
          rows: [backupRow({ status: 'completed', sizeBytes: 1234 })],
        });
      });

      const service = DatabaseBackupService.getInstance();
      const result = await service.listBackups();

      expect(queryMock.mock.calls[0][0]).toContain('Interrupted by a server restart.');
      expect(result.backups).toEqual([
        expect.objectContaining({
          id: '00000000-0000-4000-8000-000000000001',
          status: 'completed',
          sizeBytes: 1234,
          createdAt: '2026-06-10T00:00:00.000Z',
          completedAt: null,
        }),
      ]);
    });
  });

  describe('createBackup', () => {
    it('creates a backup and marks it completed once pg_dump succeeds', async () => {
      queryMock.mockImplementation((sql: string) => {
        if (sql.includes('INSERT INTO system.database_backups')) {
          return Promise.resolve({ rows: [backupRow({ name: 'before-upgrade' })] });
        }
        return Promise.resolve({ rows: [] });
      });
      spawnMock.mockImplementation(() => makeFakeChild().child);

      const service = DatabaseBackupService.getInstance();
      const backup = await service.createBackup({ name: 'before-upgrade' }, 'admin');

      expect(backup).toMatchObject({ name: 'before-upgrade', status: 'running' });

      // The dump runs asynchronously after createBackup returns, so wait for
      // the terminal status update before asserting on the side effects.
      await vi.waitFor(() => {
        const completedCall = queryMock.mock.calls.find(([sql]) =>
          (sql as string).includes("SET status = 'completed'")
        );
        expect(completedCall).toBeDefined();
      });

      expect(spawnMock).toHaveBeenCalledWith(
        'pg_dump',
        expect.arrayContaining(['--format=custom', '-d', 'insforge']),
        expect.objectContaining({ env: expect.objectContaining({ PGPASSWORD: 'postgres' }) })
      );

      const completedCall = queryMock.mock.calls.find(([sql]) =>
        (sql as string).includes("SET status = 'completed'")
      );
      const [, params] = completedCall as [string, unknown[]];
      const storageKey = params[1] as string;
      expect(storageKey).toMatch(/^\d{8}_\d{6}_[0-9a-f-]{36}\.dump$/);
      expect(params[2]).toBe(Buffer.from('dump-bytes').length);

      const artifact = await fs.readFile(
        path.join(STORAGE_DIR, '_database_backups', storageKey),
        'utf8'
      );
      expect(artifact).toBe('dump-bytes');

      await waitForIdle(service);
    });

    it('marks the backup failed when pg_dump exits nonzero', async () => {
      queryMock.mockImplementation((sql: string) => {
        if (sql.includes('INSERT INTO system.database_backups')) {
          return Promise.resolve({ rows: [backupRow()] });
        }
        return Promise.resolve({ rows: [] });
      });
      spawnMock.mockImplementation(
        () => makeFakeChild({ exitCode: 1, stderrData: 'connection refused' }).child
      );

      const service = DatabaseBackupService.getInstance();
      await service.createBackup({}, 'admin');

      await vi.waitFor(() => {
        const failedCall = queryMock.mock.calls.find(([sql]) =>
          (sql as string).includes("SET status = 'failed'")
        );
        expect(failedCall).toBeDefined();
      });

      const failedCall = queryMock.mock.calls.find(([sql]) =>
        (sql as string).includes("SET status = 'failed'")
      );
      const [, params] = failedCall as [string, unknown[]];
      expect(params[1]).toContain('pg_dump exited with code 1');
      expect(params[1]).toContain('connection refused');

      await waitForIdle(service);
    });

    it('rejects a duplicate backup name with a 409', async () => {
      queryMock.mockRejectedValueOnce(
        Object.assign(new Error('duplicate key value'), { code: '23505' })
      );

      const service = DatabaseBackupService.getInstance();
      await expect(service.createBackup({ name: 'dup' }, 'admin')).rejects.toMatchObject({
        statusCode: 409,
        code: ERROR_CODES.DATABASE_DUPLICATE,
      });
    });

    it('rejects concurrent backups while one is still running', async () => {
      queryMock.mockImplementation((sql: string) => {
        if (sql.includes('INSERT INTO system.database_backups')) {
          return Promise.resolve({ rows: [backupRow()] });
        }
        return Promise.resolve({ rows: [] });
      });
      const pending = makeFakeChild({ autoClose: false });
      spawnMock.mockImplementation(() => pending.child);

      const service = DatabaseBackupService.getInstance();
      await service.createBackup({}, 'admin');

      await expect(service.createBackup({}, 'admin')).rejects.toMatchObject({
        statusCode: 409,
        code: ERROR_CODES.DATABASE_CONSTRAINT_VIOLATION,
      });

      // Let the running dump finish only after the service has wired up the
      // child process, otherwise the 'close' event fires with no listener.
      await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());
      pending.finish();
      await waitForIdle(service);
    });

    it('reserves the concurrency guard before the first await', async () => {
      queryMock.mockImplementation((sql: string) => {
        if (sql.includes('INSERT INTO system.database_backups')) {
          return Promise.resolve({ rows: [backupRow()] });
        }
        return Promise.resolve({ rows: [] });
      });
      spawnMock.mockImplementation(() => makeFakeChild().child);

      const service = DatabaseBackupService.getInstance();
      // Fire both before either INSERT resolves; without a synchronous
      // reservation both would pass the guard.
      const first = service.createBackup({}, 'admin');
      const second = service.createBackup({}, 'admin');

      await expect(second).rejects.toMatchObject({
        statusCode: 409,
        code: ERROR_CODES.DATABASE_CONSTRAINT_VIOLATION,
      });
      await first;
      await waitForIdle(service);
    });
  });

  describe('restoreBackup', () => {
    it('refuses to restore a backup that is not completed', async () => {
      queryMock.mockImplementation((sql: string) => {
        if (sql.includes('WHERE id = $1')) {
          return Promise.resolve({ rows: [backupRow({ status: 'failed' })] });
        }
        return Promise.resolve({ rows: [] });
      });

      const service = DatabaseBackupService.getInstance();
      await expect(service.restoreBackup('some-id')).rejects.toMatchObject({
        statusCode: 409,
        code: ERROR_CODES.DATABASE_CONSTRAINT_VIOLATION,
      });
    });

    it('blocks a restore while a rename or delete is in flight', async () => {
      let releaseDelete!: (value: { rows: unknown[] }) => void;
      const gatedRow = new Promise<{ rows: unknown[] }>((resolve) => {
        releaseDelete = resolve;
      });
      queryMock.mockImplementation((sql: string) => {
        if (sql.includes('storage_key AS "storageKey"')) {
          return gatedRow;
        }
        return Promise.resolve({ rows: [] });
      });

      const service = DatabaseBackupService.getInstance();
      const deletion = service.deleteBackup('some-id');

      // The delete has passed its guard but is still awaiting the row lookup;
      // a restore starting now would snapshot metadata the delete is about to
      // change, so it must be rejected.
      await expect(service.restoreBackup('some-id')).rejects.toMatchObject({
        statusCode: 409,
        code: ERROR_CODES.DATABASE_CONSTRAINT_VIOLATION,
      });

      releaseDelete({ rows: [backupRow({ status: 'completed', storageKey: 'gone.dump' })] });
      await deletion;
    });

    it('blocks concurrent restores and metadata mutations while a restore runs', async () => {
      const storageKey = '20260610_040506.dump';
      const artifactDir = path.join(STORAGE_DIR, '_database_backups');
      await fs.mkdir(artifactDir, { recursive: true });
      await fs.writeFile(path.join(artifactDir, storageKey), 'archive-bytes');

      queryMock.mockImplementation((sql: string) => {
        if (sql.includes('WHERE id = $1')) {
          return Promise.resolve({
            rows: [backupRow({ status: 'completed', storageKey })],
          });
        }
        return Promise.resolve({ rows: [] });
      });
      const pending = makeFakeChild({ stdoutData: null, autoClose: false });
      spawnMock.mockImplementation(() => pending.child);

      const service = DatabaseBackupService.getInstance();
      const restore = service.restoreBackup('some-id');

      const conflict = {
        statusCode: 409,
        code: ERROR_CODES.DATABASE_CONSTRAINT_VIOLATION,
      };
      await expect(service.restoreBackup('some-id')).rejects.toMatchObject(conflict);
      await expect(service.deleteBackup('some-id')).rejects.toMatchObject(conflict);
      await expect(service.renameBackup('some-id', 'x')).rejects.toMatchObject(conflict);
      await expect(service.createBackup({}, 'admin')).rejects.toMatchObject(conflict);

      await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());
      pending.finish();
      await restore;
    });

    it('restores the archive and reinstates the backup metadata snapshot', async () => {
      const storageKey = '20260610_010203.dump';
      const artifactDir = path.join(STORAGE_DIR, '_database_backups');
      await fs.mkdir(artifactDir, { recursive: true });
      await fs.writeFile(path.join(artifactDir, storageKey), 'archive-bytes');

      const snapshotRow = {
        id: '00000000-0000-4000-8000-000000000002',
        name: 'kept',
        trigger_source: 'manual',
        status: 'completed',
        storage_key: storageKey,
        size_bytes: 42,
        error_message: null,
        created_by: 'admin',
        completed_at: new Date('2026-06-09T00:00:00Z'),
        created_at: new Date('2026-06-09T00:00:00Z'),
        updated_at: new Date('2026-06-09T00:00:00Z'),
      };

      queryMock.mockImplementation((sql: string) => {
        if (sql.includes('WHERE id = $1')) {
          return Promise.resolve({
            rows: [backupRow({ status: 'completed', storageKey })],
          });
        }
        return Promise.resolve({ rows: [snapshotRow] });
      });
      spawnMock.mockImplementation(() => makeFakeChild({ stdoutData: null }).child);

      const service = DatabaseBackupService.getInstance();
      await service.restoreBackup('some-id');

      expect(spawnMock).toHaveBeenCalledWith(
        'pg_restore',
        expect.arrayContaining(['--clean', '--if-exists', '--single-transaction']),
        expect.objectContaining({
          env: expect.objectContaining({ PGAPPNAME: 'insforge-backup-restore' }),
        })
      );
      // Terminating other sessions would crash the backend's own long-lived
      // clients (realtime LISTEN), so the restore flow must never do it.
      expect(
        queryMock.mock.calls.some(([sql]) => (sql as string).includes('pg_terminate_backend'))
      ).toBe(false);

      const clientSql = clientQueryMock.mock.calls.map(([sql]) => sql as string);
      expect(clientSql).toContain('BEGIN');
      expect(clientSql.some((sql) => sql.includes('TRUNCATE system.database_backups'))).toBe(true);
      expect(clientSql.some((sql) => sql.includes('INSERT INTO system.database_backups'))).toBe(
        true
      );
      expect(clientSql).toContain('COMMIT');
      // The PostgREST reload runs outside the write-back transaction so a
      // write-back failure cannot leave PostgREST on a stale schema.
      expect(queryMock.mock.calls.some(([sql]) => (sql as string).includes('NOTIFY pgrst'))).toBe(
        true
      );
      expect(clearColumnTypeCacheMock).toHaveBeenCalled();
      expect(releaseMock).toHaveBeenCalled();
    });

    it('terminates a restore stuck waiting on a database lock', async () => {
      const storageKey = '20260611_050607.dump';
      const artifactDir = path.join(STORAGE_DIR, '_database_backups');
      await fs.mkdir(artifactDir, { recursive: true });
      await fs.writeFile(path.join(artifactDir, storageKey), 'archive-bytes');

      const terminateCalls: unknown[][] = [];
      queryMock.mockImplementation((sql: string, params?: unknown[]) => {
        if (sql.includes('WHERE id = $1') && !sql.includes('pg_terminate_backend')) {
          return Promise.resolve({
            rows: [backupRow({ status: 'completed', storageKey })],
          });
        }
        if (sql.includes('pg_stat_activity')) {
          return Promise.resolve({ rows: [{ pid: 4242, waitEventType: 'Lock' }] });
        }
        if (sql.includes('pg_terminate_backend')) {
          terminateCalls.push(params ?? []);
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });
      const pending = makeFakeChild({
        stdoutData: null,
        autoClose: false,
        exitCode: 1,
        stderrData: 'FATAL: terminating connection due to administrator command',
      });
      spawnMock.mockImplementation(() => pending.child);

      vi.useFakeTimers();
      try {
        const service = DatabaseBackupService.getInstance();
        const restore = service.restoreBackup('some-id');
        restore.catch(() => {});

        // 5s polls; the session reports Lock-waiting every tick, so the
        // watchdog should terminate it once 30s of continuous waiting passes.
        await vi.advanceTimersByTimeAsync(45_000);
        expect(terminateCalls).toHaveLength(1);
        expect(terminateCalls[0]).toEqual([4242]);

        vi.useRealTimers();
        // The terminated pg_restore exits nonzero; the service maps it to a
        // clear lock-timeout error instead of the raw stderr.
        pending.finish();
        await expect(restore).rejects.toMatchObject({
          statusCode: 409,
          message: expect.stringContaining('waiting more than 30s for a database lock'),
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it('still reports success when the metadata write-back fails after retries', async () => {
      const storageKey = '20260611_010203.dump';
      const artifactDir = path.join(STORAGE_DIR, '_database_backups');
      await fs.mkdir(artifactDir, { recursive: true });
      await fs.writeFile(path.join(artifactDir, storageKey), 'archive-bytes');

      queryMock.mockImplementation((sql: string) => {
        if (sql.includes('WHERE id = $1')) {
          return Promise.resolve({
            rows: [backupRow({ status: 'completed', storageKey })],
          });
        }
        return Promise.resolve({ rows: [] });
      });
      clientQueryMock.mockImplementation((sql: string) => {
        if (sql.includes('TRUNCATE')) {
          return Promise.reject(new Error('deadlock detected'));
        }
        return Promise.resolve({ rows: [] });
      });
      spawnMock.mockImplementation(() => makeFakeChild({ stdoutData: null }).child);

      const service = DatabaseBackupService.getInstance();
      await expect(service.restoreBackup('some-id')).resolves.toBeUndefined();

      // Three attempts, each rolled back.
      const truncates = clientQueryMock.mock.calls.filter(([sql]) =>
        (sql as string).includes('TRUNCATE')
      );
      expect(truncates).toHaveLength(3);
      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to write back backup metadata'),
        expect.objectContaining({ error: 'deadlock detected' })
      );
      // PostgREST is still reloaded even though the write-back failed.
      expect(queryMock.mock.calls.some(([sql]) => (sql as string).includes('NOTIFY pgrst'))).toBe(
        true
      );
    });
  });
});
