import { Response } from 'express';

export interface ErrorResponse {
  error: string;
  message: string;
  statusCode: number;
  nextActions?: string;
}

export function successResponse<T>(res: Response, data: T, statusCode: number = 200) {
  return res.status(statusCode).json(data);
}

export function errorResponse(
  res: Response,
  error: string,
  message: string,
  statusCode: number = 500,
  nextActions?: string
) {
  const response: ErrorResponse = {
    error,
    message,
    statusCode,
    nextActions,
  };

  return res.status(statusCode).json(response);
}

// Returns data with PostgREST-style pagination headers ("Content-Range: start-end/total").
export function paginatedResponse<T>(res: Response, data: T[], total: number, offset: number) {
  const start = offset;
  const end = Math.min(offset + data.length - 1, total - 1);

  res.setHeader('Content-Range', `${start}-${end}/${total}`);
  res.setHeader('Preference-Applied', 'count=exact');

  const statusCode = data.length < total ? 206 : 200;

  return res.status(statusCode).json(data);
}
