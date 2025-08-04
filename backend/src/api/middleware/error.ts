import { Request, Response, NextFunction } from 'express';
import { DatabaseError } from 'pg';
import { errorResponse } from '@/utils/response.js';
import { ERROR_CODES, NEXT_ACTION } from '@/types/error-constants.js';
import logger from '@/utils/logger.js';

export class AppError extends Error {
  constructor(
    public message: string,
    public statusCode: number = 500,
    public code: string,
    public nextAction?: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}

// PostgreSQL error code handlers
const POSTGRES_ERROR_HANDLERS: Record<
  string,
  (err: DatabaseError) => { code: string; message: string; statusCode: number; nextAction?: string }
> = {
  // Integrity constraint violations
  '23505': (err) => {
    // unique_violation
    const detail = err.detail || '';
    const fieldMatch = detail.match(/Key \(([\w_]+)\)=/);
    const fieldName = fieldMatch ? fieldMatch[1] : 'field';
    return {
      code: ERROR_CODES.ALREADY_EXISTS,
      message: `A record with this ${fieldName} already exists.`,
      statusCode: 409,
      nextAction: NEXT_ACTION.CHECK_UNIQUE_FIELD(fieldName),
    };
  },
  '23503': () => {
    // foreign_key_violation
    return {
      code: ERROR_CODES.DATABASE_CONSTRAINT_VIOLATION,
      message: 'Referenced record does not exist.',
      statusCode: 400,
      nextAction: NEXT_ACTION.CHECK_REFERENCE_EXISTS,
    };
  },
  '23502': (err) => {
    // not_null_violation
    const column = err.column || '';
    return {
      code: ERROR_CODES.MISSING_FIELD,
      message: `The ${column} field is required and cannot be empty.`,
      statusCode: 400,
      nextAction: NEXT_ACTION.FILL_REQUIRED_FIELD(column),
    };
  },
  '42P01': () => ({
    // undefined_table
    code: ERROR_CODES.DATABASE_VALIDATION_ERROR,
    message: 'Table not found',
    statusCode: 400,
    nextAction: NEXT_ACTION.CHECK_TABLE_EXISTS,
  }),
  '42701': (err) => {
    // duplicate_column
    const message = err.message || '';
    const columnMatch = message.match(/column "([^"]+)"/);
    const columnName = columnMatch ? columnMatch[1] : '';
    return {
      code: ERROR_CODES.DATABASE_VALIDATION_ERROR,
      message: message || 'Duplicate column in table definition',
      statusCode: 400,
      nextAction: NEXT_ACTION.REMOVE_DUPLICATE_COLUMN(columnName),
    };
  },
  '42703': () => ({
    // undefined_column
    code: ERROR_CODES.DATABASE_VALIDATION_ERROR,
    message: 'Column does not exist',
    statusCode: 400,
    nextAction: NEXT_ACTION.CHECK_COLUMN_EXISTS,
  }),
  '42830': () => ({
    // invalid_foreign_key
    code: ERROR_CODES.DATABASE_VALIDATION_ERROR,
    message: 'Invalid foreign key constraint',
    statusCode: 400,
    nextAction: NEXT_ACTION.CHECK_UNIQUE_CONSTRAINT,
  }),
  '42804': () => ({
    // datatype_mismatch
    code: ERROR_CODES.DATABASE_VALIDATION_ERROR,
    message: 'Foreign key constraint cannot be created due to incompatible column types',
    statusCode: 400,
    nextAction: NEXT_ACTION.CHECK_DATATYPE_MATCH,
  }),
};

// Handle database-specific errors
function handleDatabaseError(
  err: DatabaseError
): { code: string; message: string; statusCode: number; nextAction?: string } | null {
  // Check PostgreSQL error codes
  if (err.code && POSTGRES_ERROR_HANDLERS[err.code]) {
    return POSTGRES_ERROR_HANDLERS[err.code](err);
  }

  return null;
}

// Generic error-like object that could have various properties
interface ErrorLike {
  message?: string;
  status?: number;
  statusCode?: number;
  type?: string;
  expose?: boolean;
  body?: unknown;
}

// Single type guard for all error-like objects
function isErrorObject(err: unknown): err is ErrorLike {
  return typeof err === 'object' && err !== null;
}

// Helper to safely get numeric status
function getErrorStatus(err: unknown): number | undefined {
  if (!isErrorObject(err)) {
    return undefined;
  }
  if (typeof err.status === 'number') {
    return err.status;
  }
  if (typeof err.statusCode === 'number') {
    return err.statusCode;
  }
  return undefined;
}

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
    const errorCode = err.code || getErrorCode(err.statusCode);
    return errorResponse(res, errorCode, err.message, err.statusCode, err.nextAction);
  }

  // Handle SyntaxError from JSON.parse
  if (err instanceof SyntaxError && err.message.includes('JSON')) {
    return errorResponse(
      res,
      ERROR_CODES.INVALID_INPUT,
      'Invalid JSON format',
      400,
      'Please ensure your request body contains valid JSON'
    );
  }

  // Handle PostgreSQL database errors
  if (err instanceof DatabaseError) {
    const dbError = handleDatabaseError(err);
    if (dbError) {
      return errorResponse(
        res,
        dbError.code,
        dbError.message,
        dbError.statusCode,
        dbError.nextAction
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
      'Invalid JSON in request body',
      400,
      'Please ensure your request body contains valid JSON'
    );
  }

  // Get the status code from either status or statusCode property
  const status = getErrorStatus(err);
  // Handle client errors (4xx)
  if (status && status >= 400 && status < 500) {
    const errorCode = getErrorCode(status);
    const message = err.message || 'Client error';
    const body = err.expose ? err.body : undefined;
    return errorResponse(res, errorCode, message, status, body as string | undefined);
  }

  // Default internal error with optional message
  const message = err.message || 'Internal server error';
  return errorResponse(res, ERROR_CODES.INTERNAL_ERROR, message, 500);
}

// Helper to map status codes to error codes
function getErrorCode(statusCode: number): string {
  switch (statusCode) {
    case 400:
      return ERROR_CODES.INVALID_INPUT;
    case 401:
      return ERROR_CODES.AUTH_UNAUTHORIZED;
    case 403:
      return ERROR_CODES.FORBIDDEN;
    case 404:
      return ERROR_CODES.NOT_FOUND;
    case 409:
      return ERROR_CODES.ALREADY_EXISTS;
    default:
      return ERROR_CODES.INTERNAL_ERROR;
  }
}
