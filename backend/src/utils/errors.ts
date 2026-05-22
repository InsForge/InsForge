import { DatabaseError } from 'pg';
import { ERROR_CODES } from '@insforge/shared-schemas';
import { NEXT_ACTIONS } from './next-actions.js';

export class AppError extends Error {
  constructor(
    public message: string,
    public statusCode: number = 500,
    public code: string,
    public nextActions?: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export interface ErrorLike {
  message?: string;
  status?: number;
  statusCode?: number;
  response?: {
    status?: unknown;
    data?: unknown;
    statusText?: unknown;
  };
  type?: string;
  expose?: boolean;
  body?: unknown;
}

export interface PgErrorLike {
  code?: unknown;
  constraint?: unknown;
}

export interface ErrorResponseDetails {
  code: string;
  message: string;
  statusCode: number;
  nextActions?: string;
}

const POSTGRES_ERROR_HANDLERS: Record<string, (err: DatabaseError) => ErrorResponseDetails> = {
  '23505': (err) => {
    const detail = err.detail || '';
    const fieldMatch = detail.match(/Key \(([\w_]+)\)=/);
    const fieldName = fieldMatch ? fieldMatch[1] : 'field';
    return {
      code: ERROR_CODES.DATABASE_DUPLICATE,
      message: err.message,
      statusCode: 409,
      nextActions: NEXT_ACTIONS.CHECK_UNIQUE_FIELD(fieldName),
    };
  },
  '23503': (err) => ({
    code: ERROR_CODES.DATABASE_CONSTRAINT_VIOLATION,
    message: err.message,
    statusCode: 400,
    nextActions: NEXT_ACTIONS.CHECK_REFERENCE_EXISTS,
  }),
  '23502': (err) => {
    const column = err.column || '';
    return {
      code: ERROR_CODES.MISSING_FIELD,
      message: err.message,
      statusCode: 400,
      nextActions: NEXT_ACTIONS.FILL_REQUIRED_FIELD(column),
    };
  },
  '42P01': (err) => ({
    code: ERROR_CODES.DATABASE_VALIDATION_ERROR,
    message: err.message,
    statusCode: 400,
    nextActions: NEXT_ACTIONS.CHECK_TABLE_EXISTS,
  }),
  '42701': (err) => {
    const message = err.message || '';
    const columnMatch = message.match(/column "([^"]+)"/);
    const columnName = columnMatch ? columnMatch[1] : '';
    return {
      code: ERROR_CODES.DATABASE_VALIDATION_ERROR,
      message: err.message,
      statusCode: 400,
      nextActions: NEXT_ACTIONS.REMOVE_DUPLICATE_COLUMN(columnName),
    };
  },
  '42703': (err) => ({
    code: ERROR_CODES.DATABASE_VALIDATION_ERROR,
    message: err.message,
    statusCode: 400,
    nextActions: NEXT_ACTIONS.CHECK_COLUMN_EXISTS,
  }),
  '42830': (err) => ({
    code: ERROR_CODES.DATABASE_VALIDATION_ERROR,
    message: err.message,
    statusCode: 400,
    nextActions: NEXT_ACTIONS.CHECK_UNIQUE_CONSTRAINT,
  }),
  '42804': (err) => ({
    code: ERROR_CODES.DATABASE_VALIDATION_ERROR,
    message: err.message,
    statusCode: 400,
    nextActions: NEXT_ACTIONS.CHECK_DATATYPE_MATCH,
  }),
  '42501': (err) => ({
    code: ERROR_CODES.FORBIDDEN,
    message: err.message,
    statusCode: 403,
    nextActions: NEXT_ACTIONS.CHECK_RLS_POLICY,
  }),
};

export function isErrorObject(err: unknown): err is ErrorLike {
  return typeof err === 'object' && err !== null;
}

export function getErrorStatus(err: unknown): number | undefined {
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

export function isPgErrorLike(error: unknown): error is PgErrorLike {
  return typeof error === 'object' && error !== null;
}

export function hasPgErrorCode(error: unknown, code: string): error is PgErrorLike {
  return isPgErrorLike(error) && error.code === code;
}

export function getDatabaseErrorDetails(err: DatabaseError): ErrorResponseDetails | null {
  if (err.code && POSTGRES_ERROR_HANDLERS[err.code]) {
    return POSTGRES_ERROR_HANDLERS[err.code](err);
  }

  return null;
}

function stringifyUpstreamPayload(payload: unknown): string | null {
  if (typeof payload === 'string' && payload.trim()) {
    return payload;
  }
  if (typeof payload === 'number' || typeof payload === 'boolean') {
    return String(payload);
  }
  if (Array.isArray(payload) && payload.length === 0) {
    return null;
  }
  if (isErrorObject(payload)) {
    if (!Array.isArray(payload) && Object.keys(payload).length === 0) {
      return null;
    }
    try {
      return JSON.stringify(payload);
    } catch {
      return null;
    }
  }
  return null;
}

export function getUpstreamErrorMessage(error: unknown, fallbackMessage: string): string {
  const responsePayload = isErrorObject(error)
    ? stringifyUpstreamPayload(error.response?.data)
    : null;
  if (responsePayload) {
    return responsePayload;
  }
  if (isErrorObject(error) && typeof error.message === 'string' && error.message.trim()) {
    return error.message;
  }
  if (
    isErrorObject(error) &&
    typeof error.response?.statusText === 'string' &&
    error.response.statusText.trim()
  ) {
    return error.response.statusText;
  }
  return fallbackMessage;
}

export function getUpstreamStatus(error: unknown, fallbackStatus = 502): number {
  if (isErrorObject(error) && typeof error.response?.status === 'number') {
    return error.response.status;
  }
  return getErrorStatus(error) ?? fallbackStatus;
}

export class UpstreamError extends AppError {
  constructor(
    error: unknown,
    fallbackMessage: string,
    code: string = ERROR_CODES.UPSTREAM_FAILURE,
    fallbackStatus = 502
  ) {
    super(
      getUpstreamErrorMessage(error, fallbackMessage),
      getUpstreamStatus(error, fallbackStatus),
      code
    );
    this.name = 'UpstreamError';
  }
}

export function getErrorCode(statusCode: number): string {
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
