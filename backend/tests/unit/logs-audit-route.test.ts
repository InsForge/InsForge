import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../src/api/middlewares/auth', () => ({
  verifyAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const queryMock = vi.fn();
vi.mock('../../src/services/logs/audit.service', () => ({
  AuditService: {
    getInstance: () => ({ query: queryMock }),
  },
}));

vi.mock('../../src/services/logs/log.service', () => ({
  LogService: {
    getInstance: () => ({}),
  },
}));

const { logsRouter } = await import('../../src/api/routes/logs/index.routes');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/logs', logsRouter);
  a.use(
    (
      err: { statusCode?: number; message?: string },
      _req: unknown,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      res: any,
      _next: unknown
    ) => {
      void _next;
      res.status(err.statusCode ?? 500).json({ message: err.message });
    }
  );
  return a;
}

describe('GET /logs/audits limit parsing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockResolvedValue({ records: [], total: 0 });
  });

  it('passes an explicit limit=0 through unchanged', async () => {
    await request(app()).get('/logs/audits').query({ limit: '0' });

    expect(queryMock).toHaveBeenCalledWith(expect.objectContaining({ limit: 0 }));
  });

  it.each([
    ['a blank string', ''],
    ['a whitespace-only string', '   '],
    ['a fractional value', '1.5'],
    ['a non-numeric value', 'abc'],
    ['a negative value', '-5'],
    ['a value beyond Number.MAX_SAFE_INTEGER', '100000000000000000000'],
  ])('falls back to the default limit of 100 for %s', async (_label, rawLimit) => {
    await request(app()).get('/logs/audits').query({ limit: rawLimit });

    expect(queryMock).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }));
  });

  it('defaults limit to 100 when not supplied at all', async () => {
    await request(app()).get('/logs/audits');

    expect(queryMock).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }));
  });
});
