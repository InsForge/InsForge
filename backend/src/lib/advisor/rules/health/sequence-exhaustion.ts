import type { AdvisorRule } from '@/lib/advisor/types.js';
import { runSqlRule } from '../helpers.js';

const sql = `
  WITH sequence_usage AS (
    SELECT
      schemaname,
      sequencename,
      last_value,
      min_value,
      max_value,
      CASE
        WHEN last_value IS NULL OR max_value = min_value THEN NULL
        ELSE (last_value - min_value)::numeric / nullif((max_value - min_value)::numeric, 0)
      END AS used_ratio
    FROM pg_catalog.pg_sequences
    WHERE schemaname = 'public'
      AND increment_by > 0
      AND NOT cycle
  )
  SELECT
    format('%I.%I', schemaname, sequencename) AS affected_object,
    format(
      'Sequence %I.%I is %s%% used.',
      schemaname,
      sequencename,
      round(used_ratio * 100, 2)
    ) AS detail,
    'Increase the sequence type/range, reset ownership strategy, or migrate the column before the sequence is exhausted.' AS recommendation,
    jsonb_build_object(
      'schema', schemaname,
      'sequence', sequencename,
      'last_value', last_value,
      'min_value', min_value,
      'max_value', max_value,
      'used_ratio', used_ratio
    ) AS metadata
  FROM sequence_usage
  WHERE used_ratio > 0.90
  ORDER BY used_ratio DESC
`;

export const sequenceExhaustionRule: AdvisorRule = {
  id: 'sequence-exhaustion',
  category: 'health',
  severity: 'critical',
  title: 'Sequence Exhaustion',
  description: 'Detects sequences that have used more than 90 percent of their available range.',
  run: (executor) => runSqlRule(sequenceExhaustionRule, executor, sql),
};
