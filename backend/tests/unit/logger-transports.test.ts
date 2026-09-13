import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import nodeFs from 'fs';
import * as path from 'path';
import winston from 'winston';

const logsDir = path.join(__dirname, 'test-logger-logs');

const VOLUME_OWNERSHIP_CHOWN =
  'docker run --rm -v <stack>_insforge-logs:/a -v <stack>_storage-data:/b alpine chown -R 1000:1000 /a /b';

vi.mock('../../src/infra/config/app.config', () => ({
  appConfig: {
    app: { logLevel: 'info' },
    server: { logsDir: path.join(__dirname, 'test-logger-logs') },
  },
}));

const originalProfile = process.env.AWS_INSTANCE_PROFILE_NAME;

async function importLoggerModule() {
  vi.resetModules();
  return import('../../src/utils/logger.ts');
}

async function importLogger() {
  const { logger } = await importLoggerModule();
  return logger;
}

function recipeFromWriteSync(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls
    .filter((call) => call[0] === 2)
    .map((call) => String(call[1]))
    .join('');
}

async function withUnwritableLogsDir<T>(fn: () => Promise<T>): Promise<T> {
  await fs.mkdir(logsDir, { recursive: true });
  await fs.chmod(logsDir, 0o555);
  try {
    return await fn();
  } finally {
    await fs.chmod(logsDir, 0o700);
    await fs.rm(logsDir, { recursive: true, force: true });
  }
}

describe('logger transports', () => {
  beforeEach(() => {
    delete process.env.AWS_INSTANCE_PROFILE_NAME;
  });

  afterEach(async () => {
    try {
      await fs.chmod(logsDir, 0o700);
    } catch {
      // Directory may not exist yet.
    }
    await fs.rm(logsDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  afterAll(() => {
    if (originalProfile !== undefined) {
      process.env.AWS_INSTANCE_PROFILE_NAME = originalProfile;
    } else {
      delete process.env.AWS_INSTANCE_PROFILE_NAME;
    }
  });

  it('writes insforge.logs.jsonl when self-hosted', async () => {
    const logger = await importLogger();

    const file = logger.transports.find(
      (t): t is winston.transports.FileTransportInstance => t instanceof winston.transports.File
    );
    expect(file).toBeDefined();

    // Rotation keeps the file bounded; tailable keeps the newest entries in
    // the base file LocalFileProvider reads
    expect(file?.maxsize).toBe(20 * 1024 * 1024);
    expect(file?.maxFiles).toBe(2);
    expect(file?.tailable).toBe(true);

    // The directory is created eagerly so the file transport can open its stream
    await expect(fs.access(logsDir)).resolves.toBeUndefined();
  });

  it('round-trips winston lines through LocalFileProvider', async () => {
    const logger = await importLogger();

    logger.info('Round trip works');
    // Raw Error objects must survive serialization (the prevailing call-site
    // pattern is `logger.error('...', { error })` with a real Error)
    logger.error('Round trip failed', { error: new Error('kaboom') });

    const { LocalFileProvider } = await import('../../src/providers/logs/local.provider.ts');
    const provider = new LocalFileProvider();
    await provider.initialize();

    // The file transport flushes asynchronously; poll briefly. initialize()
    // itself logs through the same logger, so match the exact lines.
    let plain: { eventMessage: string }[] = [];
    let errored: { eventMessage: string }[] = [];
    for (let i = 0; i < 20 && (plain.length === 0 || errored.length === 0); i++) {
      const { logs } = await provider.getLogsBySource('insforge.logs');
      plain = logs.filter((l) => l.eventMessage === 'info - Round trip works');
      errored = logs.filter((l) => l.eventMessage.startsWith('error - Round trip failed'));
      if (plain.length === 0 || errored.length === 0) {
        await new Promise((r) => setTimeout(r, 50));
      }
    }

    expect(plain).toHaveLength(1);
    expect(errored).toHaveLength(1);
    expect(errored[0].eventMessage).toContain('Error: kaboom');
    expect(errored[0].eventMessage).toContain('Stack Trace:');
  });

  it('does not add a file transport in cloud environments', async () => {
    process.env.AWS_INSTANCE_PROFILE_NAME = 'insforge-instance-profile';
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    const logger = await importLogger();

    expect(logger.transports.some((t) => t instanceof winston.transports.File)).toBe(false);
    expect(logger.transports.some((t) => t instanceof winston.transports.Console)).toBe(true);
    expect(exitSpy).not.toHaveBeenCalled();
    await expect(fs.access(logsDir)).rejects.toThrow();
  });

  it('does not attach a File transport when LOGS_DIR is unwritable', async () => {
    await withUnwritableLogsDir(async () => {
      const logger = await importLogger();
      expect(logger.transports.some((t) => t instanceof winston.transports.File)).toBe(false);
    });
  });

  it('does not hang when logging to an unwritable LOGS_DIR', async () => {
    await withUnwritableLogsDir(async () => {
      const logger = await importLogger();
      expect(logger.transports.some((t) => t instanceof winston.transports.File)).toBe(false);

      const started = Date.now();
      logger.info('should not hang');
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('log write exceeded 2000ms')), 2000);
        logger.once('finish', () => {
          clearTimeout(timer);
          resolve();
        });
        logger.end();
      });
      expect(Date.now() - started).toBeLessThanOrEqual(2000);
    });
  }, 2500);

  it('prints the Alpine chown command when LOGS_DIR is unwritable', async () => {
    const writeSyncSpy = vi.spyOn(nodeFs, 'writeSync');
    await withUnwritableLogsDir(async () => {
      const mod = await importLoggerModule();
      expect(mod.VOLUME_OWNERSHIP_CHOWN).toBe(VOLUME_OWNERSHIP_CHOWN);
      expect(recipeFromWriteSync(writeSyncSpy)).toContain(VOLUME_OWNERSHIP_CHOWN);
    });
  });

  it('calls injected exit(1) and omits File when vitest is false', async () => {
    await fs.mkdir(logsDir, { recursive: true });
    await fs.chmod(logsDir, 0o555);
    try {
      const { createSelfHostFileTransport } = await importLoggerModule();
      const exit = vi.fn();
      const transport = createSelfHostFileTransport({
        logsDir,
        vitest: false,
        exit,
      });
      expect(transport).toBeUndefined();
      expect(exit).toHaveBeenCalledTimes(1);
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      await fs.chmod(logsDir, 0o700);
    }
  });

  it('omits File, prints chown, and does not exit when VITEST is set', async () => {
    expect(process.env.VITEST).toBeTruthy();
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const writeSyncSpy = vi.spyOn(nodeFs, 'writeSync');
    await withUnwritableLogsDir(async () => {
      const logger = await importLogger();
      expect(logger.transports.some((t) => t instanceof winston.transports.File)).toBe(false);
      expect(exitSpy).not.toHaveBeenCalled();
      expect(recipeFromWriteSync(writeSyncSpy)).toContain(VOLUME_OWNERSHIP_CHOWN);
    });
  });

  it('fails loud when insforge.logs.jsonl is 0444 in a writable directory', async () => {
    await fs.mkdir(logsDir, { recursive: true });
    const jsonl = path.join(logsDir, 'insforge.logs.jsonl');
    await fs.writeFile(jsonl, '');
    await fs.chmod(jsonl, 0o444);
    const writeSyncSpy = vi.spyOn(nodeFs, 'writeSync');
    try {
      const started = Date.now();
      const { logger, createSelfHostFileTransport } = await importLoggerModule();
      expect(logger.transports.some((t) => t instanceof winston.transports.File)).toBe(false);

      const exit = vi.fn();
      const transport = createSelfHostFileTransport({
        logsDir,
        vitest: false,
        exit,
      });
      expect(transport).toBeUndefined();
      expect(Date.now() - started).toBeLessThanOrEqual(2000);
      expect(recipeFromWriteSync(writeSyncSpy)).toContain(VOLUME_OWNERSHIP_CHOWN);
      expect(exit).toHaveBeenCalledTimes(1);
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      await fs.chmod(jsonl, 0o644);
      await fs.chmod(logsDir, 0o700);
    }
  }, 2500);

  it('still exits when writeSync to fd 2 throws EPIPE', async () => {
    await fs.mkdir(logsDir, { recursive: true });
    await fs.chmod(logsDir, 0o555);
    const writeSyncSpy = vi.spyOn(nodeFs, 'writeSync').mockImplementation((fd) => {
      if (fd === 2) {
        throw Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
      }
      return 0;
    });
    try {
      const { createSelfHostFileTransport } = await importLoggerModule();
      const exit = vi.fn();
      const transport = createSelfHostFileTransport({
        logsDir,
        vitest: false,
        exit,
      });
      expect(transport).toBeUndefined();
      expect(writeSyncSpy).toHaveBeenCalledWith(2, expect.stringContaining(VOLUME_OWNERSHIP_CHOWN));
      expect(exit).toHaveBeenCalledTimes(1);
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      await fs.chmod(logsDir, 0o700);
    }
  });
});
