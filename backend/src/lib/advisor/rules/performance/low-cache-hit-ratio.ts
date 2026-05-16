import type { AdvisorRule } from '@/lib/advisor/types.js';
import { runSqlRule } from '../helpers.js';

const sql = `
  SELECT
    datname AS affected_object,
    format(
      'Database %I has buffer cache hit ratio of %s%%.',
      datname,
      round((blks_hit::numeric / nullif(blks_hit + blks_read, 0)) * 100, 2)
    ) AS detail,
    'Investigate frequently read tables and indexes. Consider query/index changes or more memory if the workload is expected.' AS recommendation,
    jsonb_build_object(
      'database', datname,
      'blks_hit', blks_hit,
      'blks_read', blks_read,
      'cache_hit_ratio', blks_hit::numeric / nullif(blks_hit + blks_read, 0)
    ) AS metadata
  FROM pg_catalog.pg_stat_database
  WHERE datname = current_database()
    AND blks_hit + blks_read > 0
    AND blks_hit::numeric / nullif(blks_hit + blks_read, 0) < 0.90
`;

export const lowCacheHitRatioRule: AdvisorRule = {
  id: 'low-cache-hit-ratio',
  category: 'performance',
  severity: 'warning',
  title: 'Low Cache Hit Ratio',
  description: 'Detects databases with buffer cache hit ratio below 90 percent.',
  run: (executor) => runSqlRule(lowCacheHitRatioRule, executor, sql),
};
