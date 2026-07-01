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

    expect(logger.transports.some((t) => t instanceof winston.transports.File)).toBe(true);

    // The directory is created eagerly so the file transport can open its stream
    await expect(fs.access(logsDir)).resolves.toBeUndefined();
  });

  it('round-trips a winston line through LocalFileProvider', async () => {
    const logger = await importLogger();

    logger.info('Round trip works');

    const { LocalFileProvider } = await import('../../src/providers/logs/local.provider.ts');
    const provider = new LocalFileProvider();
    await provider.initialize();

    // The file transport flushes asynchronously; poll briefly. initialize()
    // itself logs through the same logger, so match the exact line.
    let matches: { eventMessage: string }[] = [];
    for (let i = 0; i < 20 && matches.length === 0; i++) {
      const { logs } = await provider.getLogsBySource('insforge.logs');
      matches = logs.filter((l) => l.eventMessage === 'info - Round trip works');
      if (matches.length === 0) {
        await new Promise((r) => setTimeout(r, 50));
      }
    }

    expect(matches).toHaveLength(1);
  });

  it('does not add a file transport in cloud environments', async () => {
    process.env.AWS_INSTANCE_PROFILE_NAME = 'insforge-instance-profile';

    const logger = await importLogger();

    expect(logger.transports.some((t) => t instanceof winston.transports.File)).toBe(false);
    expect(logger.transports.some((t) => t instanceof winston.transports.Console)).toBe(true);
    await expect(fs.access(logsDir)).rejects.toThrow();
  });
});
