import { Request, Response, NextFunction } from 'express';
import { DatabaseError } from 'pg';
import { errorResponse } from '@/utils/response.js';
import { ERROR_CODES } from '@insforge/shared-schemas';
import logger from '@/utils/logger.js';
import { AppError, getDatabaseErrorDetails, isErrorObject } from '@/utils/errors.js';

export function errorMiddleware(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  // Only log non-authentication errors or unexpected errors
  if (!(err instanceof AppError && err.statusCode === 401)) {
    logger.error('Error occurred', {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
  }

  // Handle known AppError instances
  if (err instanceof AppError) {
    return errorResponse(res, err.code, err.message, err.statusCode, err.nextActions);
  }

  // Handle SyntaxError from JSON.parse
  if (err instanceof SyntaxError && err.message.includes('JSON')) {
    return errorResponse(
      res,
      ERROR_CODES.INVALID_INPUT,
      err.message,
      400,
      'Please ensure your request body contains valid JSON'
    );
  }

  // Handle PostgreSQL database errors
  if (err instanceof DatabaseError) {
    const dbError = getDatabaseErrorDetails(err);
    if (dbError) {
      return errorResponse(
        res,
        dbError.code,
        dbError.message,
        dbError.statusCode,
        dbError.nextActions
      );
    }
  }

  // For all other errors, check if it's an object we can work with
  if (!isErrorObject(err)) {
    return errorResponse(res, ERROR_CODES.INTERNAL_ERROR, 'Internal server error', 500);
  }

  // Handle JSON parsing errors from body-parser
  if (err.type === 'entity.parse.failed' && err.status === 400) {
    return errorResponse(
      res,
      ERROR_CODES.INVALID_INPUT,
      err.message || 'Invalid JSON in request body',
      400,
      'Please ensure your request body contains valid JSON'
    );
  }

  // Default: generic 500 response — never leak raw error messages to client
  return errorResponse(res, ERROR_CODES.INTERNAL_ERROR, 'Internal server error', 500);
}
