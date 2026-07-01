import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import * as path from 'path';

const logsDir = path.join(__dirname, 'test-insforge-logs');

vi.mock('../../src/infra/config/app.config', () => ({
  appConfig: {
    server: { logsDir: path.join(__dirname, 'test-insforge-logs') },
  },
}));

vi.mock('../../src/utils/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import { LocalFileProvider } from '../../src/providers/logs/local.provider.ts';

// Line shapes as written by the winston file transport (utils/logger.ts)
const winstonAppLog = {
  id: '1-0.1',
  timestamp: '2026-07-01T10:00:00.000Z',
  message: 'Server started',
  level: 'info',
  metadata: {},
};

const winstonErrorLog = {
  id: '2-0.2',
  timestamp: '2026-07-01T10:01:00.000Z',
  message: 'Failed to sync functions',
  level: 'error',
  metadata: { error: 'boom', stack: 'Error: boom\n  at x.ts:1' },
};

const winstonRequestLog = {
  id: '3-0.3',
  timestamp: '2026-07-01T10:02:00.000Z',
  message: 'HTTP Request',
  level: 'info',
  metadata: {
    method: 'GET',
    path: '/api/health',
    status: 200,
    size: 17,
    duration: '12ms',
    ip: '127.0.0.1',
    userAgent: 'curl/8.0',
  },
};

// Line shape shipped by the legacy Vector sidecar
const vectorLog = {
  appname: 'insforge',
  timestamp: '2026-07-01T09:59:00.000Z',
  event_message: 'legacy vector line',
  metadata: { level: 'info' },
};

describe('LocalFileProvider', () => {
  let provider: LocalFileProvider;

  beforeEach(async () => {
    await fs.mkdir(logsDir, { recursive: true });
    provider = new LocalFileProvider();
    await provider.initialize();
  });

  afterEach(async () => {
    await fs.rm(logsDir, { recursive: true, force: true });
  });

  async function writeLogFile(lines: unknown[]) {
    await fs.writeFile(
      path.join(logsDir, 'insforge.logs.jsonl'),
      lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n'
    );
  }

  it('parses winston application log lines', async () => {
    await writeLogFile([winstonAppLog]);

    const { logs } = await provider.getLogsBySource('insforge.logs');

    expect(logs).toHaveLength(1);
    expect(logs[0].eventMessage).toBe('info - Server started');
    expect(logs[0].timestamp).toBe(winstonAppLog.timestamp);
  });

  it('appends error and stack for winston error lines', async () => {
    await writeLogFile([winstonErrorLog]);

    const { logs } = await provider.getLogsBySource('insforge.logs');

    expect(logs).toHaveLength(1);
    expect(logs[0].eventMessage).toContain('error - Failed to sync functions');
    expect(logs[0].eventMessage).toContain('Error: boom');
    expect(logs[0].eventMessage).toContain('Stack Trace:');
  });

  it('formats winston HTTP request lines nginx-style', async () => {
    await writeLogFile([winstonRequestLog]);

    const { logs } = await provider.getLogsBySource('insforge.logs');

    expect(logs).toHaveLength(1);
    expect(logs[0].eventMessage).toBe('GET /api/health 200 17 12ms - 127.0.0.1 - curl/8.0');
  });

  it('still parses legacy Vector lines', async () => {
    await writeLogFile([vectorLog]);

    const { logs } = await provider.getLogsBySource('insforge.logs');

    expect(logs).toHaveLength(1);
    expect(logs[0].eventMessage).toBe('legacy vector line');
  });

  it('skips unparseable and unknown-shape lines', async () => {
    await writeLogFile(['not json', { some: 'unrelated object' }, winstonAppLog]);

    const { logs } = await provider.getLogsBySource('insforge.logs');

    expect(logs).toHaveLength(1);
    expect(logs[0].eventMessage).toBe('info - Server started');
  });

  it('respects the beforeTimestamp filter', async () => {
    await writeLogFile([winstonAppLog, winstonErrorLog]);

    const { logs } = await provider.getLogsBySource(
      'insforge.logs',
      100,
      '2026-07-01T10:00:30.000Z'
    );

    expect(logs).toHaveLength(1);
    expect(logs[0].timestamp).toBe(winstonAppLog.timestamp);
  });

  it('returns empty for a missing log file', async () => {
    const { logs, total } = await provider.getLogsBySource('postgres.logs');

    expect(logs).toHaveLength(0);
    expect(total).toBe(0);
  });

  it('searches across winston lines', async () => {
    await writeLogFile([winstonAppLog, winstonErrorLog]);

    const { logs, total } = await provider.searchLogs('boom');

    expect(total).toBe(1);
    expect(logs[0].source).toBe('insforge.logs');
  });
});
