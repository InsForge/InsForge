import type { PoolClient } from 'pg';
import { APPROX_COUNT_THRESHOLD, FILTERED_COUNT_CAP } from '@/utils/constants.js';

export interface CountResult {
  total: number;
  /** True when `total` is a planner estimate or a capped lower bound, not an exact count. */
  isEstimate: boolean;
}

/** How an unfiltered table should be counted, given the planner's `reltuples`. */
export type UnfilteredCountStrategy =
  | { kind: 'estimate'; total: number }
  | { kind: 'exact' }
  | { kind: 'capped' };

/**
 * `reltuples` is -1 on a never-analyzed table (PG14+) and 0 on older versions, where 0
 * is also what an empty table reports -- both mean "size unknown", so the scan is capped.
 */
export function decideUnfilteredCount(reltuples: number | null): UnfilteredCountStrategy {
  if (reltuples === null || !Number.isFinite(reltuples) || reltuples <= 0) {
    return { kind: 'capped' };
  }
  if (reltuples <= APPROX_COUNT_THRESHOLD) {
    return { kind: 'exact' };
  }
  return { kind: 'estimate', total: Math.round(reltuples) };
}

/** Interprets a capped count that scanned at most `cap + 1` rows. */
export function decideCappedCount(observed: number, cap: number): CountResult {
  return observed > cap ? { total: cap, isEstimate: true } : { total: observed, isEstimate: false };
}

/**
 * Counts rows without the unbounded `COUNT(*)` the data browser used to run on every
 * page load. No branch here can scan more than `cap + 1` rows or read a planner stat.
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
    const strategy = decideUnfilteredCount(raw === null || raw === undefined ? null : Number(raw));

    if (strategy.kind === 'estimate') {
      return { total: strategy.total, isEstimate: true };
    }

    // Known-small tables are counted exactly (cheap, and precision is worth more);
    // unknown-size tables are capped, so a never-analyzed huge table can't be scanned.
    if (strategy.kind === 'exact') {
      const exact = await client.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total FROM ${qualifiedTableName}`
      );
      return { total: Number(exact.rows[0]?.total ?? 0), isEstimate: false };
    }

    return decideCappedCount(
      await countUpTo(client, qualifiedTableName, '', [], APPROX_COUNT_THRESHOLD),
      APPROX_COUNT_THRESHOLD
    );
  }

  // `reltuples` says nothing about a WHERE, so filtered sets are counted for real but
  // stop one row past the cap -- that extra row distinguishes "exactly cap" from "more".
  return decideCappedCount(
    await countUpTo(client, qualifiedTableName, whereSql, params, FILTERED_COUNT_CAP),
    FILTERED_COUNT_CAP
  );
}

async function countUpTo(
  client: PoolClient,
  qualifiedTableName: string,
  whereSql: string,
  params: unknown[],
  cap: number
): Promise<number> {
  const result = await client.query<{ observed: string }>(
    `SELECT COUNT(*)::text AS observed FROM (SELECT 1 FROM ${qualifiedTableName}${whereSql} LIMIT ${cap + 1}) AS capped`,
    params
  );
  return Number(result.rows[0]?.observed ?? 0);
}
