import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import * as path from 'path';
import winston from 'winston';

const logsDir = path.join(__dirname, 'test-logger-logs');

vi.mock('../../src/infra/config/app.config', () => ({
  appConfig: {
    app: { logLevel: 'info' },
    server: { logsDir: path.join(__dirname, 'test-logger-logs') },
  },
}));

const originalProfile = process.env.AWS_INSTANCE_PROFILE_NAME;

async function importLogger() {
  vi.resetModules();
  const { logger } = await import('../../src/utils/logger.ts');
  return logger;
}

describe('logger transports', () => {
  beforeEach(() => {
    delete process.env.AWS_INSTANCE_PROFILE_NAME;
  });

  afterEach(async () => {
    await fs.rm(logsDir, { recursive: true, force: true });
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

    const logger = await importLogger();

    expect(logger.transports.some((t) => t instanceof winston.transports.File)).toBe(false);
    expect(logger.transports.some((t) => t instanceof winston.transports.Console)).toBe(true);
    await expect(fs.access(logsDir)).rejects.toThrow();
  });
});
