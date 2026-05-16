import type { AdvisorRule } from '@/lib/advisor/types.js';
import { runSqlRule } from '../helpers.js';

const sql = `
  WITH table_stats AS (
    SELECT
      schemaname,
      relname,
      n_live_tup,
      CASE
        WHEN last_analyze IS NULL THEN last_autoanalyze
        WHEN last_autoanalyze IS NULL THEN last_analyze
        ELSE greatest(last_analyze, last_autoanalyze)
      END AS last_analyzed
    FROM pg_catalog.pg_stat_user_tables
    WHERE schemaname = 'public'
  )
  SELECT
    format('%I.%I', schemaname, relname) AS affected_object,
    CASE
      WHEN last_analyzed IS NULL THEN format('Table %I.%I has rows but has never been analyzed.', schemaname, relname)
      ELSE format('Table %I.%I statistics were last analyzed at %s.', schemaname, relname, last_analyzed)
    END AS detail,
    'Run ANALYZE or verify autovacuum analyze settings so the planner has fresh statistics.' AS recommendation,
    jsonb_build_object(
      'schema', schemaname,
      'table', relname,
      'n_live_tup', n_live_tup,
      'last_analyzed', last_analyzed
    ) AS metadata
  FROM table_stats
  WHERE n_live_tup > 0
    AND (
      last_analyzed IS NULL
      OR last_analyzed < now() - interval '7 days'
    )
  ORDER BY last_analyzed NULLS FIRST, schemaname, relname
`;

export const staleStatisticsRule: AdvisorRule = {
  id: 'stale-statistics',
  category: 'health',
  severity: 'info',
  title: 'Stale Statistics',
  description: 'Detects tables whose planner statistics are older than seven days.',
  run: (executor) => runSqlRule(staleStatisticsRule, executor, sql),
};
