/** PostgreSQL data types that should preserve empty strings instead of stripping them. */
export const TEXT_LIKE_DATA_TYPES = new Set(['text', 'character varying', 'character', 'citext']);

/**
 * Row-count estimate above which an unfiltered table is counted with the planner's
 * `pg_class.reltuples` statistic instead of an exact `COUNT(*)`. Below it, the exact
 * count is cheap enough to be worth its precision.
 */
export const APPROX_COUNT_THRESHOLD = 50_000;

/**
 * Upper bound for counting a *filtered* result set. `reltuples` says nothing about a
 * WHERE clause, so filtered counts stay exact but stop early: once this many matching
 * rows are seen the total is reported as an estimate ("10,000+") rather than scanning on.
 */
export const FILTERED_COUNT_CAP = 10_000;

const DEFAULT_ADMIN_RECORD_STATEMENT_TIMEOUT = '15s';

/**
 * `statement_timeout` values are interpolated into `SET LOCAL` (PostgreSQL cannot bind a
 * parameter there), so the configured value must be safe by construction rather than by
 * quoting. Accepts a bare integer (milliseconds) or an integer with a time unit.
 */
export function isValidStatementTimeout(value: string): boolean {
  return /^\d+\s*(ms|s|min|h|d)?$/.test(value.trim());
}

/**
 * Transaction-scoped `statement_timeout` for the dashboard's admin record reads. A
 * pathological scan (deep OFFSET, unindexable search) fails with a clear error instead
 * of holding a connection until the client gives up. An unparseable override falls back
 * to the default rather than injecting the raw string into SQL.
 */
export const ADMIN_RECORD_STATEMENT_TIMEOUT = (() => {
  const configured = process.env.ADMIN_RECORD_STATEMENT_TIMEOUT?.trim();
  if (configured && isValidStatementTimeout(configured)) {
    return configured;
  }
  return DEFAULT_ADMIN_RECORD_STATEMENT_TIMEOUT;
})();
