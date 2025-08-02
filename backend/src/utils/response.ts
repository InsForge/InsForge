import { Response } from 'express';

// Traditional REST response - data returned directly
// Error responses use standard HTTP status codes with error body

export interface ErrorResponse {
  error: string;
  message: string;
  statusCode: number;
  nextAction?: string;
}

export interface PaginationMeta {
  total: number;
  limit: number;
  offset: number;
  page?: number;
  totalPages?: number;
}

// Traditional REST success response - returns data directly
export function successResponse<T>(res: Response, data: T, statusCode: number = 200) {
  return res.status(statusCode).json(data);
}

// Traditional REST error response
export function errorResponse(
  res: Response,
  error: string,
  message: string,
  statusCode: number = 500,
  nextAction?: string
) {
  const response: ErrorResponse = {
    error,
    message,
    statusCode,
    nextAction,
  };

  return res.status(statusCode).json(response);
}

// Pagination response helper - returns data with pagination headers
export function paginatedResponse<T>(
  res: Response,
  data: T[],
  total: number,
  limit: number,
  offset: number
) {
  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.ceil(total / limit);

  // Set pagination headers
  res.setHeader('X-Total-Count', total.toString());
  res.setHeader('X-Page', page.toString());
  res.setHeader('X-Total-Pages', totalPages.toString());
  res.setHeader('X-Limit', limit.toString());
  res.setHeader('X-Offset', offset.toString());

  return res.status(200).json(data);
}
