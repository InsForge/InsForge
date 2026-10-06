/** PostgreSQL data types that should preserve empty strings instead of stripping them. */
export const TEXT_LIKE_DATA_TYPES = new Set(['text', 'character varying', 'character', 'citext']);

/**
 * Above this many rows an unfiltered table is counted from the planner's
 * `pg_class.reltuples`; below it an exact `COUNT(*)` is cheap enough to be worth it.
 */
export const APPROX_COUNT_THRESHOLD = 50_000;

/** Upper bound for counting a filtered result set; past it the total reads "10,000+". */
export const FILTERED_COUNT_CAP = 10_000;

const DEFAULT_ADMIN_RECORD_STATEMENT_TIMEOUT = '15s';

/**
 * `SET LOCAL` cannot bind a parameter, so the value is interpolated and must be safe by
 * construction. Accepts a bare integer (ms) or an integer with a time unit.
 */
export function isValidStatementTimeout(value: string): boolean {
  return /^\d+\s*(ms|s|min|h|d)?$/.test(value.trim());
}

/**
 * Bounds the dashboard's admin record reads, so a pathological scan fails with a clear
 * error instead of holding a connection. An invalid override falls back to the default.
 */
export const ADMIN_RECORD_STATEMENT_TIMEOUT = (() => {
  const configured = process.env.ADMIN_RECORD_STATEMENT_TIMEOUT?.trim();
  if (configured && isValidStatementTimeout(configured)) {
    return configured;
  }
  return DEFAULT_ADMIN_RECORD_STATEMENT_TIMEOUT;
})();
