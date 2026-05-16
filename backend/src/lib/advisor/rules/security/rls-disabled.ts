import type { AdvisorRule } from '@/lib/advisor/types.js';
import { runSqlRule } from '../helpers.js';

const sql = `
  SELECT
    format('%I.%I', n.nspname, c.relname) AS affected_object,
    format('Table %I.%I is in the public schema but row level security is not enabled.', n.nspname, c.relname) AS detail,
    'Enable row level security and add policies that match the intended access model.' AS recommendation,
    jsonb_build_object(
      'schema', n.nspname,
      'table', c.relname,
      'relrowsecurity', c.relrowsecurity
    ) AS metadata
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n
    ON n.oid = c.relnamespace
  LEFT JOIN pg_catalog.pg_depend dep
    ON dep.objid = c.oid
    AND dep.deptype = 'e'
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND NOT c.relrowsecurity
    AND dep.objid IS NULL
  ORDER BY n.nspname, c.relname
`;

export const rlsDisabledRule: AdvisorRule = {
  id: 'rls-disabled',
  category: 'security',
  severity: 'critical',
  title: 'RLS Disabled',
  description: 'Tables in the public schema should have row level security enabled.',
  run: (executor) => runSqlRule(rlsDisabledRule, executor, sql),
};
