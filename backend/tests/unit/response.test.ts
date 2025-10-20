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
});
