import type { AdvisorRule } from '@/lib/advisor/types.js';
import { runSqlRule } from '../helpers.js';

const sql = `
  WITH expanded_policies AS (
    SELECT
      n.nspname AS schema_name,
      c.relname AS table_name,
      p.polname AS policy_name,
      CASE
        WHEN role_oid = 0 THEN 'public'
        ELSE role_oid::regrole::text
      END AS role_name,
      action_name
    FROM pg_catalog.pg_policy p
    JOIN pg_catalog.pg_class c
      ON c.oid = p.polrelid
    JOIN pg_catalog.pg_namespace n
      ON n.oid = c.relnamespace
    CROSS JOIN LATERAL unnest(
      CASE
        WHEN p.polroles = ARRAY[0::oid] THEN ARRAY[0::oid]
        ELSE p.polroles
      END
    ) AS policy_roles(role_oid)
    CROSS JOIN LATERAL unnest(
      CASE p.polcmd
        WHEN 'r' THEN ARRAY['SELECT']
        WHEN 'a' THEN ARRAY['INSERT']
        WHEN 'w' THEN ARRAY['UPDATE']
        WHEN 'd' THEN ARRAY['DELETE']
        WHEN '*' THEN ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']
        ELSE ARRAY['UNKNOWN']
      END
    ) AS policy_actions(action_name)
    LEFT JOIN pg_catalog.pg_depend dep
      ON dep.objid = c.oid
      AND dep.deptype = 'e'
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relrowsecurity
      AND p.polpermissive
      AND dep.objid IS NULL
  )
  SELECT
    format('%I.%I', schema_name, table_name) AS affected_object,
    format(
      'Table %I.%I has multiple permissive RLS policies for role %s and action %s: %s.',
      schema_name,
      table_name,
      role_name,
      action_name,
      array_to_string(array_agg(policy_name ORDER BY policy_name), ', ')
    ) AS detail,
    'Merge overlapping permissive policies or convert one of them to a restrictive policy so each role/action has one clear access path.' AS recommendation,
    jsonb_build_object(
      'schema', schema_name,
      'table', table_name,
      'role', role_name,
      'action', action_name,
      'policies', array_agg(policy_name ORDER BY policy_name)
    ) AS metadata
  FROM expanded_policies
  GROUP BY schema_name, table_name, role_name, action_name
  HAVING count(*) > 1
  ORDER BY schema_name, table_name, role_name, action_name
`;

export const rlsPermissiveRule: AdvisorRule = {
  id: 'rls-permissive',
  category: 'security',
  severity: 'warning',
  title: 'Multiple Permissive RLS Policies',
  description: 'Detects tables with multiple permissive policies for the same role and action.',
  run: (executor) => runSqlRule(rlsPermissiveRule, executor, sql),
};
