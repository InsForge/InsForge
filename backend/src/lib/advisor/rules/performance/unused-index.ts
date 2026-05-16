import type { AdvisorRule } from '@/lib/advisor/types.js';
import { runSqlRule } from '../helpers.js';

const sql = `
  SELECT
    format('%I.%I.%I', psui.schemaname, psui.relname, psui.indexrelname) AS affected_object,
    format('Index %I on table %I.%I has never been used.', psui.indexrelname, psui.schemaname, psui.relname) AS detail,
    'Review whether this index is still needed. Drop it if it is not used by expected workloads.' AS recommendation,
    jsonb_build_object(
      'schema', psui.schemaname,
      'table', psui.relname,
      'index', psui.indexrelname,
      'idx_scan', psui.idx_scan
    ) AS metadata
  FROM pg_catalog.pg_stat_user_indexes psui
  JOIN pg_catalog.pg_index pi
    ON pi.indexrelid = psui.indexrelid
  LEFT JOIN pg_catalog.pg_depend dep
    ON dep.objid = psui.relid
    AND dep.deptype = 'e'
  WHERE psui.schemaname = 'public'
    AND psui.idx_scan = 0
    AND NOT pi.indisunique
    AND NOT pi.indisprimary
    AND dep.objid IS NULL
  ORDER BY psui.schemaname, psui.relname, psui.indexrelname
`;

export const unusedIndexRule: AdvisorRule = {
  id: 'unused-index',
  category: 'performance',
  severity: 'info',
  title: 'Unused Index',
  description: 'Detects non-primary, non-unique indexes that have never been scanned.',
  run: (executor) => runSqlRule(unusedIndexRule, executor, sql),
};
