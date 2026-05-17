import { describe, expect, it } from 'vitest';
import type { QueryResultRow } from 'pg';
import type {
  AdvisorQueryExecutor,
  AdvisorRule,
  AdvisorRuleResultRow,
} from '../../src/lib/advisor/types.js';
import { advisorRules } from '../../src/lib/advisor/rules/index.js';

function makeExecutor(rows: AdvisorRuleResultRow[]) {
  const calls: Array<{ sql: string; values?: readonly unknown[] }> = [];
  const executor: AdvisorQueryExecutor = {
    query: async <T extends QueryResultRow = QueryResultRow>(
      sql: string,
      values?: readonly unknown[]
    ) => {
      calls.push({ sql, values });
      return { rows: rows as unknown as T[] };
    },
  };

  return { executor, calls };
}

function makeThrowingExecutor(error: unknown): AdvisorQueryExecutor {
  return {
    query: async () => {
      throw error;
    },
  };
}

function makePgError(code: string) {
  return Object.assign(new Error(`Postgres error ${code}`), { code });
}

function getRule(ruleId: string): AdvisorRule {
  const rule = advisorRules.find((candidate) => candidate.id === ruleId);

  if (!rule) {
    throw new Error(`Missing advisor rule ${ruleId}`);
  }

  return rule;
}

const seededRowsByRuleId: Record<string, AdvisorRuleResultRow> = {
  'rls-disabled': {
    affected_object: 'public.customers',
    detail: 'Table public.customers is in the public schema but RLS is not enabled.',
    recommendation: 'Enable RLS and add access policies.',
    metadata: { schema: 'public', table: 'customers' },
  },
  'rls-permissive': {
    affected_object: 'public.orders/authenticated/SELECT',
    detail: 'Table public.orders has multiple permissive SELECT policies.',
    recommendation: 'Merge duplicate permissive policies.',
    metadata: { schema: 'public', table: 'orders', role: 'authenticated' },
  },
  'rls-no-policy': {
    affected_object: 'public.invoices',
    detail: 'Table public.invoices has RLS enabled but no policies exist.',
    recommendation: 'Add at least one RLS policy.',
    metadata: { schema: 'public', table: 'invoices' },
  },
  'dangerous-function': {
    affected_object: 'public.recalculate_total',
    detail: 'Function public.recalculate_total has a mutable search_path.',
    recommendation: 'Set an explicit search_path on the function.',
    metadata: { schema: 'public', function: 'recalculate_total' },
  },
  'rls-select-only': {
    affected_object: 'public.profiles',
    detail: 'Table public.profiles has RLS policies defined but RLS is not enabled.',
    recommendation: 'Enable RLS so the defined policies are enforced.',
    metadata: { schema: 'public', table: 'profiles' },
  },
  'missing-fk-index': {
    affected_object: 'public.orders.customer_id',
    detail: 'Foreign key orders_customer_id_fkey does not have a covering index.',
    recommendation: 'Create an index on customer_id.',
    metadata: { schema: 'public', table: 'orders', constraint: 'orders_customer_id_fkey' },
  },
  'unused-index': {
    affected_object: 'public.orders.idx_orders_unused',
    detail: 'Index idx_orders_unused has never been scanned.',
    recommendation: 'Drop the index if it is not needed.',
    metadata: { schema: 'public', table: 'orders', index: 'idx_orders_unused' },
  },
  'slow-query': {
    affected_object: 'select * from public.orders',
    detail: 'Query has mean execution time over one second.',
    recommendation: 'Inspect the query plan.',
    metadata: { calls: 12, mean_exec_time_ms: 1200 },
  },
  'connection-high': {
    affected_object: 'postgres connections',
    detail: 'Connection usage is above 80 percent.',
    recommendation: 'Reduce open connections or raise max_connections.',
    metadata: { used_connections: 82, max_connections: 100 },
  },
  'connection-critical': {
    affected_object: 'postgres connections',
    detail: 'Connection usage is above 95 percent.',
    recommendation: 'Immediately reduce open connections.',
    metadata: { used_connections: 97, max_connections: 100 },
  },
  'idle-in-transaction': {
    affected_object: 'pid 1234',
    detail: 'Session 1234 is idle in transaction.',
    recommendation: 'Close or terminate the idle transaction.',
    metadata: { pid: 1234, state: 'idle in transaction' },
  },
  'low-cache-hit-ratio': {
    affected_object: 'database cache',
    detail: 'Cache hit ratio is below 90 percent.',
    recommendation: 'Review memory and query patterns.',
    metadata: { cache_hit_ratio: 0.85 },
  },
  'long-running-query': {
    affected_object: 'pid 4321',
    detail: 'Query has been running longer than five minutes.',
    recommendation: 'Review or terminate the query.',
    metadata: { pid: 4321, duration_seconds: 360 },
  },
  'rls-policy-perf': {
    affected_object: 'public.orders.orders_select_own',
    detail: 'Policy calls auth.uid() per row without a SELECT wrapper.',
    recommendation: 'Wrap auth.uid() as (select auth.uid()).',
    metadata: { schema: 'public', table: 'orders', policy: 'orders_select_own' },
  },
  'missing-rls-index': {
    affected_object: 'public.orders.user_id',
    detail: 'RLS policy filters on user_id without an index.',
    recommendation: 'Create an index on user_id.',
    metadata: { schema: 'public', table: 'orders', column: 'user_id' },
  },
  'dead-tuples': {
    affected_object: 'public.events',
    detail: 'Table public.events has too many dead tuples.',
    recommendation: 'Run VACUUM or tune autovacuum.',
    metadata: { schema: 'public', table: 'events', dead_tuple_ratio: 0.3 },
  },
  'stale-statistics': {
    affected_object: 'public.events',
    detail: 'Table public.events has stale statistics.',
    recommendation: 'Run ANALYZE or check autovacuum analyze settings.',
    metadata: { schema: 'public', table: 'events', last_analyze: null },
  },
  'sequence-exhaustion': {
    affected_object: 'public.events_id_seq',
    detail: 'Sequence public.events_id_seq is more than 90 percent used.',
    recommendation: 'Increase the sequence range.',
    metadata: { schema: 'public', sequence: 'events_id_seq', used_ratio: 0.92 },
  },
  'autovacuum-blocked': {
    affected_object: 'public.events',
    detail: 'Autovacuum is blocked on table public.events.',
    recommendation: 'Resolve blocking sessions so autovacuum can finish.',
    metadata: { schema: 'public', table: 'events', blocker_pid: 100 },
  },
};

describe('advisor rule registry', () => {
  it('registers the expected 19 advisor rules in issue order', () => {
    expect(advisorRules.map((rule) => rule.id)).toEqual([
      'rls-disabled',
      'rls-permissive',
      'rls-no-policy',
      'dangerous-function',
      'rls-select-only',
      'missing-fk-index',
      'unused-index',
      'slow-query',
      'connection-high',
      'connection-critical',
      'idle-in-transaction',
      'low-cache-hit-ratio',
      'long-running-query',
      'rls-policy-perf',
      'missing-rls-index',
      'dead-tuples',
      'stale-statistics',
      'sequence-exhaustion',
      'autovacuum-blocked',
    ]);
  });

  it('assigns each rule to the expected advisor category', () => {
    expect(advisorRules.map((rule) => [rule.id, rule.category])).toEqual([
      ['rls-disabled', 'security'],
      ['rls-permissive', 'security'],
      ['rls-no-policy', 'security'],
      ['dangerous-function', 'security'],
      ['rls-select-only', 'security'],
      ['missing-fk-index', 'performance'],
      ['unused-index', 'performance'],
      ['slow-query', 'performance'],
      ['connection-high', 'performance'],
      ['connection-critical', 'performance'],
      ['idle-in-transaction', 'performance'],
      ['low-cache-hit-ratio', 'performance'],
      ['long-running-query', 'performance'],
      ['rls-policy-perf', 'performance'],
      ['missing-rls-index', 'performance'],
      ['dead-tuples', 'health'],
      ['stale-statistics', 'health'],
      ['sequence-exhaustion', 'health'],
      ['autovacuum-blocked', 'health'],
    ]);
  });
});

describe('advisor rules', () => {
  it.each(advisorRules)('$id maps seeded database rows into advisor findings', async (rule) => {
    const row = seededRowsByRuleId[rule.id];
    const { executor, calls } = makeExecutor([row]);

    const findings = await rule.run(executor);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toMatch(/\bselect\b/i);
    expect(findings).toEqual([
      {
        id: `${rule.id}:${row.affected_object}:0`,
        ruleId: rule.id,
        category: rule.category,
        severity: rule.severity,
        title: rule.title,
        description: rule.description,
        detail: row.detail,
        recommendation: row.recommendation,
        affectedObject: row.affected_object,
        metadata: row.metadata,
      },
    ]);
  });

  it.each(advisorRules)('$id returns no findings when the query returns no rows', async (rule) => {
    const { executor, calls } = makeExecutor([]);

    await expect(rule.run(executor)).resolves.toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('treats missing pg_stat_statements as no slow-query findings', async () => {
    const rule = getRule('slow-query');

    await expect(rule.run(makeThrowingExecutor(makePgError('42P01')))).resolves.toEqual([]);
    await expect(rule.run(makeThrowingExecutor(makePgError('42703')))).resolves.toEqual([]);
  });

  it('rethrows unexpected slow-query errors', async () => {
    const rule = getRule('slow-query');

    await expect(rule.run(makeThrowingExecutor(makePgError('XX000')))).rejects.toThrow(
      'Postgres error XX000'
    );
  });
});
