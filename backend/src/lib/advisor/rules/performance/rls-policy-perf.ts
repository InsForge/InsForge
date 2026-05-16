import type { AdvisorRule } from '@/lib/advisor/types.js';
import { runSqlRule } from '../helpers.js';

const sql = `
  WITH policies AS (
    SELECT
      n.nspname AS schema_name,
      c.relname AS table_name,
      p.polname AS policy_name,
      pgp.qual,
      pgp.with_check
    FROM pg_catalog.pg_policy p
    JOIN pg_catalog.pg_class c
      ON c.oid = p.polrelid
    JOIN pg_catalog.pg_namespace n
      ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_policies pgp
      ON pgp.schemaname = n.nspname
      AND pgp.tablename = c.relname
      AND pgp.policyname = p.polname
    LEFT JOIN pg_catalog.pg_depend dep
      ON dep.objid = c.oid
      AND dep.deptype = 'e'
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relrowsecurity
      AND dep.objid IS NULL
  )
  SELECT
    format('%I.%I.%I', schema_name, table_name, policy_name) AS affected_object,
    format(
      'Policy %I on table %I.%I calls auth.uid() directly, which can be evaluated per row.',
      policy_name,
      schema_name,
      table_name
    ) AS detail,
    'Wrap auth.uid() in a scalar subquery, for example (SELECT auth.uid()), so PostgreSQL can evaluate it once per statement.' AS recommendation,
    jsonb_build_object(
      'schema', schema_name,
      'table', table_name,
      'policy', policy_name,
      'using', qual,
      'with_check', with_check
    ) AS metadata
  FROM policies
  WHERE (
      coalesce(qual, '') LIKE '%auth.uid()%'
      AND lower(coalesce(qual, '')) NOT LIKE '%select auth.uid()%'
    )
    OR (
      coalesce(with_check, '') LIKE '%auth.uid()%'
      AND lower(coalesce(with_check, '')) NOT LIKE '%select auth.uid()%'
    )
  ORDER BY schema_name, table_name, policy_name
`;

export const rlsPolicyPerfRule: AdvisorRule = {
  id: 'rls-policy-perf',
  category: 'performance',
  severity: 'warning',
  title: 'RLS Policy Auth Function Per Row',
  description:
    'Detects RLS policies that call auth.uid() directly instead of wrapping it in SELECT.',
  run: (executor) => runSqlRule(rlsPolicyPerfRule, executor, sql),
};
