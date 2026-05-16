import type { AdvisorRule } from '@/lib/advisor/types.js';
import { runSqlRule } from '../helpers.js';

const sql = `
  WITH usage AS (
    SELECT
      count(*)::numeric AS used_connections,
      current_setting('max_connections')::numeric AS max_connections
    FROM pg_catalog.pg_stat_activity
  )
  SELECT
    current_database() AS affected_object,
    format(
      'Connection usage is at %s%% (%s of %s connections).',
      round((used_connections / nullif(max_connections, 0)) * 100, 2),
      used_connections,
      max_connections
    ) AS detail,
    'Investigate connection pooling and close idle clients before the database reaches its connection limit.' AS recommendation,
    jsonb_build_object(
      'used_connections', used_connections,
      'max_connections', max_connections,
      'usage_ratio', used_connections / nullif(max_connections, 0)
    ) AS metadata
  FROM usage
  WHERE used_connections / nullif(max_connections, 0) >= 0.80
    AND used_connections / nullif(max_connections, 0) < 0.95
`;

export const connectionHighRule: AdvisorRule = {
  id: 'connection-high',
  category: 'performance',
  severity: 'warning',
  title: 'Connection Usage High',
  description: 'Detects database connection usage above 80 percent.',
  run: (executor) => runSqlRule(connectionHighRule, executor, sql),
};
