import type { AdvisorRule } from '@/lib/advisor/types.js';
import { runSqlRule } from '../helpers.js';

const sql = `
  SELECT
    format('%I.%I', n.nspname, c.relname) AS affected_object,
    format('Table %I.%I has RLS enabled but no policies are defined.', n.nspname, c.relname) AS detail,
    'Create explicit SELECT, INSERT, UPDATE, and DELETE policies for the roles that should access this table.' AS recommendation,
    jsonb_build_object(
      'schema', n.nspname,
      'table', c.relname
    ) AS metadata
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n
    ON n.oid = c.relnamespace
  LEFT JOIN pg_catalog.pg_policy p
    ON p.polrelid = c.oid
  LEFT JOIN pg_catalog.pg_depend dep
    ON dep.objid = c.oid
    AND dep.deptype = 'e'
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND c.relrowsecurity
    AND p.oid IS NULL
    AND dep.objid IS NULL
  ORDER BY n.nspname, c.relname
`;

export const rlsNoPolicyRule: AdvisorRule = {
  id: 'rls-no-policy',
  category: 'security',
  severity: 'warning',
  title: 'RLS Enabled With No Policies',
  description: 'Tables with RLS enabled but no policies are inaccessible to non-bypass roles.',
  run: (executor) => runSqlRule(rlsNoPolicyRule, executor, sql),
};
