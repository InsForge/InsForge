import type { AdvisorRule } from '@/lib/advisor/types.js';
import { runSqlRule } from '../helpers.js';

const sql = `
  SELECT
    format('%I.%I', schemaname, relname) AS affected_object,
    format(
      'Table %I.%I has %s dead tuples, about %s%% of tracked tuples.',
      schemaname,
      relname,
      n_dead_tup,
      round((n_dead_tup::numeric / greatest(n_live_tup + n_dead_tup, 1)) * 100, 2)
    ) AS detail,
    'Run VACUUM or tune autovacuum settings if this table frequently accumulates dead tuples.' AS recommendation,
    jsonb_build_object(
      'schema', schemaname,
      'table', relname,
      'n_live_tup', n_live_tup,
      'n_dead_tup', n_dead_tup,
      'dead_tuple_ratio', n_dead_tup::numeric / greatest(n_live_tup + n_dead_tup, 1)
    ) AS metadata
  FROM pg_catalog.pg_stat_user_tables
  WHERE schemaname = 'public'
    AND n_dead_tup > 1000
    AND n_dead_tup::numeric / greatest(n_live_tup + n_dead_tup, 1) > 0.20
  ORDER BY n_dead_tup DESC
`;

export const deadTuplesRule: AdvisorRule = {
  id: 'dead-tuples',
  category: 'health',
  severity: 'warning',
  title: 'High Dead Tuples',
  description: 'Detects tables with high dead tuple counts that may need vacuuming.',
  run: (executor) => runSqlRule(deadTuplesRule, executor, sql),
};
