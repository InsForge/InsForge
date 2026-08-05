import type { PoolClient } from 'pg';
import { APPROX_COUNT_THRESHOLD, FILTERED_COUNT_CAP } from '@/utils/constants.js';

export interface CountResult {
  total: number;
  /**
   * True when `total` is not an exact row count: either the planner's `reltuples`
   * statistic, or a filtered count that stopped at {@link FILTERED_COUNT_CAP}
   * (i.e. "at least this many"). Clients render these as "~N" / "N+".
   */
  isEstimate: boolean;
}

/**
 * Decides how an *unfiltered* table should be counted, given the planner's
 * `reltuples` statistic.
 *
 * `reltuples` is -1 on a never-analyzed table (PostgreSQL 14+) and 0 on older
 * versions, where 0 is also what a genuinely empty table reports. Both are
 * treated as "unknown" and fall through to the exact count — which is free on an
 * empty table and correct on an un-analyzed one, so the ambiguity costs nothing.
 *
 * Split out from the query so the branching is unit-testable without a database.
 */
export function decideUnfilteredCount(reltuples: number | null): CountResult | null {
  if (reltuples === null || !Number.isFinite(reltuples) || reltuples <= 0) {
    return null; // unknown or empty -> caller runs the exact count
  }

  if (reltuples <= APPROX_COUNT_THRESHOLD) {
    return null; // small enough that an exact count is cheap and worth the precision
  }

  return { total: Math.round(reltuples), isEstimate: true };
}

/**
 * Interprets the result of the capped filtered count. `observed` is the number of
 * matching rows seen while scanning at most `FILTERED_COUNT_CAP + 1` of them.
 */
export function decideFilteredCount(observed: number): CountResult {
  if (observed > FILTERED_COUNT_CAP) {
    return { total: FILTERED_COUNT_CAP, isEstimate: true };
  }
  return { total: observed, isEstimate: false };
}

/**
 * Counts rows without the unbounded `COUNT(*)` full scan that the dashboard's data
 * browser used to pay on every page load and every keystroke of search.
 *
 * - Unfiltered, large table: one O(1) `pg_class` catalog lookup instead of an O(N) scan.
 * - Unfiltered, small/unknown table: exact `COUNT(*)` (cheap, and precise).
 * - Filtered: exact, but stops after {@link FILTERED_COUNT_CAP} matches. This bounds the
 *   common "search matches lots of rows" case. A search matching *few* rows still scans
 *   the table — only an index can fix that, so the statement timeout is the backstop.
 *
 * `qualifiedTableName` must already be quoted via `quoteQualifiedName`; `whereSql` is
 * either empty or a leading-space ` WHERE ...` fragment whose placeholders bind `params`.
 */
export async function estimateOrExactCount(
  client: PoolClient,
  qualifiedTableName: string,
  whereSql: string,
  params: unknown[]
): Promise<CountResult> {
  if (whereSql === '') {
    const estimateResult = await client.query<{ reltuples: string | null }>(
      `SELECT reltuples::bigint::text AS reltuples FROM pg_class WHERE oid = to_regclass($1)`,
      [qualifiedTableName]
    );

    const raw = estimateResult.rows[0]?.reltuples;
    const decided = decideUnfilteredCount(raw === null || raw === undefined ? null : Number(raw));
    if (decided) {
      return decided;
    }

    const exact = await client.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM ${qualifiedTableName}`
    );
    return { total: Number(exact.rows[0]?.total ?? 0), isEstimate: false };
  }

  // Filtered: `reltuples` says nothing about a WHERE clause, so count for real but
  // stop one row past the cap — that single extra row is what distinguishes
  // "exactly CAP" from "CAP or more".
  const capped = await client.query<{ observed: string }>(
    `SELECT COUNT(*)::text AS observed FROM (SELECT 1 FROM ${qualifiedTableName}${whereSql} LIMIT ${FILTERED_COUNT_CAP + 1}) AS capped`,
    params
  );

  return decideFilteredCount(Number(capped.rows[0]?.observed ?? 0));
}
