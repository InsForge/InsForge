import type { AdvisorRule } from '@/lib/advisor/types.js';
import { runOptionalPgStatStatementsRule } from '../helpers.js';

const sql = `
  SELECT
    left(regexp_replace(query, '\\s+', ' ', 'g'), 160) AS affected_object,
    format('Query has mean execution time of %s ms across %s calls.', round(mean_exec_time::numeric, 2), calls) AS detail,
    'Inspect the query plan and add indexes or rewrite the query if needed.' AS recommendation,
    jsonb_build_object(
      'query', query,
      'calls', calls,
      'mean_exec_time_ms', mean_exec_time,
      'total_exec_time_ms', total_exec_time
    ) AS metadata
  FROM pg_stat_statements
  WHERE mean_exec_time > 1000
  ORDER BY mean_exec_time DESC
  LIMIT 50
`;

export const slowQueryRule: AdvisorRule = {
  id: 'slow-query',
  category: 'performance',
  severity: 'warning',
  title: 'Slow Query',
  description: 'Detects queries whose mean execution time is greater than one second.',
  run: (executor) => runOptionalPgStatStatementsRule(slowQueryRule, executor, sql),
};
