import { describe, expect, it, vi } from 'vitest';
import { DatabaseError } from 'pg';
import type { Request, Response } from 'express';
import { errorMiddleware, AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';

vi.mock('@/utils/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

function makeMockRes() {
  const res = {} as Response & {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
    statusCode?: number;
    body?: unknown;
  };
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn((body: unknown) => {
    res.body = body;
    return res;
  });
  return res;
}

function makePgError(code: string, message: string): DatabaseError {
  // pg's DatabaseError ctor isn't ergonomic; build a shaped instance.
  const err = new DatabaseError(message, message.length, 'error');
  Object.assign(err, { code });
  return err;
}

describe('errorMiddleware — RLS / 42501 mapping', () => {
  it('translates Postgres 42501 (RLS WITH CHECK denial) into 403 with FORBIDDEN', () => {
    const err = makePgError(
      '42501',
      'new row violates row-level security policy for table "objects"'
    );
    const req = {} as Request;
    const res = makeMockRes();
    const next = vi.fn();

    errorMiddleware(err, req, res, next);

    expect(res.statusCode).toBe(403);
    const body = res.body as { error: string; message: string; nextActions?: string };
    expect(body.error).toBe(ERROR_CODES.FORBIDDEN);
    expect(body.message).toContain('row-level security');
    // The hint should mention RLS so a developer can self-diagnose.
    expect(body.nextActions).toMatch(/row-level security|RLS|policy/i);
  });

  it('still maps 23505 (unique violation) to 409 — regression check', () => {
    const err = makePgError('23505', 'duplicate key value violates unique constraint');
    err.detail = 'Key (key)=(note.txt) already exists.';
    const req = {} as Request;
    const res = makeMockRes();
    const next = vi.fn();

    errorMiddleware(err, req, res, next);

    expect(res.statusCode).toBe(409);
  });

  it('passes AppError through with its declared status', () => {
    const err = new AppError('bad input', 400, ERROR_CODES.INVALID_INPUT);
    const req = {} as Request;
    const res = makeMockRes();
    const next = vi.fn();

    errorMiddleware(err, req, res, next);

    expect(res.statusCode).toBe(400);
    const body = res.body as { error: string };
    expect(body.error).toBe(ERROR_CODES.INVALID_INPUT);
  });

  it('falls back to 500 for unrecognized pg codes', () => {
    const err = makePgError('XX000', 'internal error');
    const req = {} as Request;
    const res = makeMockRes();
    const next = vi.fn();

    errorMiddleware(err, req, res, next);

    expect(res.statusCode).toBe(500);
  });
});
