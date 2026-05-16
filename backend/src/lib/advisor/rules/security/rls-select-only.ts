import type { AdvisorRule } from '@/lib/advisor/types.js';
import { runSqlRule } from '../helpers.js';

const sql = `
  SELECT
    format('%I.%I', n.nspname, c.relname) AS affected_object,
    format(
      'Table %I.%I has RLS policies defined but RLS is not enabled. Policies: %s.',
      n.nspname,
      c.relname,
      array_to_string(array_agg(p.polname ORDER BY p.polname), ', ')
    ) AS detail,
    'Enable RLS on the table so the defined policies are actually enforced.' AS recommendation,
    jsonb_build_object(
      'schema', n.nspname,
      'table', c.relname,
      'policies', array_agg(p.polname ORDER BY p.polname)
    ) AS metadata
  FROM pg_catalog.pg_policy p
  JOIN pg_catalog.pg_class c
    ON c.oid = p.polrelid
  JOIN pg_catalog.pg_namespace n
    ON n.oid = c.relnamespace
  LEFT JOIN pg_catalog.pg_depend dep
    ON dep.objid = c.oid
    AND dep.deptype = 'e'
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND NOT c.relrowsecurity
    AND dep.objid IS NULL
  GROUP BY n.nspname, c.relname
  ORDER BY n.nspname, c.relname
`;

export const rlsSelectOnlyRule: AdvisorRule = {
  id: 'rls-select-only',
  category: 'security',
  severity: 'critical',
  title: 'RLS Policies Not Enforced',
  description: 'Detects tables with RLS policies defined while RLS is disabled on the table.',
  run: (executor) => runSqlRule(rlsSelectOnlyRule, executor, sql),
};
