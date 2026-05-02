export interface PgErrorLike {
  code?: unknown;
  constraint?: unknown;
}

export function isPgErrorLike(error: unknown): error is PgErrorLike {
  return typeof error === 'object' && error !== null;
}

export function hasPgErrorCode(error: unknown, code: string): error is PgErrorLike {
  return isPgErrorLike(error) && error.code === code;
}
