import { successResponse, errorResponse, paginatedResponse } from '../../src/utils/response';
import { Response } from 'express';
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Response Utilities', () => {
  let res: Partial<Response>;

  beforeEach(() => {
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      setHeader: vi.fn().mockReturnThis(),
    };
  });

  it('successResponse returns data with correct status', () => {
    const data = { message: 'ok' };
    successResponse(res as Response, data, 201);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(data);
  });

  it('errorResponse returns error with correct status', () => {
    const error = 'ERROR';
    const message = 'Something went wrong';
    errorResponse(res as Response, error, message, 400, 'Retry');
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error,
      message,
      statusCode: 400,
      nextActions: 'Retry',
    });
  });

  it('paginatedResponse sets headers and status correctly', () => {
    const data = [1, 2, 3];
    const total = 10;
    const offset = 0;

    paginatedResponse(res as Response, data, total, offset);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Range', '0-2/10');
    expect(res.setHeader).toHaveBeenCalledWith('Preference-Applied', 'count=exact');
    expect(res.status).toHaveBeenCalledWith(206); // partial content
    expect(res.json).toHaveBeenCalledWith(data);
  });

  it('paginatedResponse returns 200 when all items returned', () => {
    const data = [1, 2, 3];
    const total = 3;
    const offset = 0;

    paginatedResponse(res as Response, data, total, offset);

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('paginatedResponse marks approximate totals without changing Content-Range', () => {
    paginatedResponse(res as Response, [1, 2], 5_000_000, 0, { isEstimate: true });

    expect(res.setHeader).toHaveBeenCalledWith('Content-Range', '0-1/5000000');
    expect(res.setHeader).toHaveBeenCalledWith('X-Total-Is-Estimate', 'true');
    expect(res.setHeader).toHaveBeenCalledWith('Preference-Applied', 'count=planned');
  });

  it('paginatedResponse omits the estimate header for exact counts', () => {
    paginatedResponse(res as Response, [1, 2], 10, 0);

    const headers = (res.setHeader as ReturnType<typeof vi.fn>).mock.calls.map(([name]) => name);
    expect(headers).not.toContain('X-Total-Is-Estimate');
  });

  // An undershooting estimate would otherwise emit a range like "60000-50000/50001".
  it('paginatedResponse never advertises a total below the rows it returned', () => {
    paginatedResponse(res as Response, [1, 2, 3], 50, 100, { isEstimate: true });

    expect(res.setHeader).toHaveBeenCalledWith('Content-Range', '100-102/103');
  });

  // Regression: an empty page past the end must not invent a total from its own
  // offset (this reported "50-49/50" and a 206).
  it('paginatedResponse keeps the reported total when the page is empty', () => {
    paginatedResponse(res as Response, [], 0, 50);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Range', '50--1/0');
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
