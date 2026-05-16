import type { AdvisorRule } from '@/lib/advisor/types.js';
import { runSqlRule } from '../helpers.js';

const sql = `
  WITH policy_columns AS (
    SELECT DISTINCT
      n.nspname AS schema_name,
      c.relname AS table_name,
      c.oid AS table_oid,
      a.attname AS column_name,
      a.attnum AS column_attnum,
      p.polname AS policy_name
    FROM pg_catalog.pg_policy p
    JOIN pg_catalog.pg_class c
      ON c.oid = p.polrelid
    JOIN pg_catalog.pg_namespace n
      ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_policies pgp
      ON pgp.schemaname = n.nspname
      AND pgp.tablename = c.relname
      AND pgp.policyname = p.polname
    JOIN pg_catalog.pg_attribute a
      ON a.attrelid = c.oid
      AND a.attnum > 0
      AND NOT a.attisdropped
    LEFT JOIN pg_catalog.pg_depend dep
      ON dep.objid = c.oid
      AND dep.deptype = 'e'
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relrowsecurity
      AND dep.objid IS NULL
      AND (
        coalesce(pgp.qual, '') LIKE '%auth.uid()%'
        OR coalesce(pgp.with_check, '') LIKE '%auth.uid()%'
      )
      AND (
        lower(coalesce(pgp.qual, '')) LIKE '%' || lower(a.attname) || '%'
        OR lower(coalesce(pgp.with_check, '')) LIKE '%' || lower(a.attname) || '%'
      )
  )
  SELECT
    format('%I.%I.%I', pc.schema_name, pc.table_name, pc.column_name) AS affected_object,
    format(
      'RLS policy %I on table %I.%I filters on column %I but no index covers that column.',
      pc.policy_name,
      pc.schema_name,
      pc.table_name,
      pc.column_name
    ) AS detail,
    'Create an index on the policy filter column to avoid full table scans during RLS checks.' AS recommendation,
    jsonb_build_object(
      'schema', pc.schema_name,
      'table', pc.table_name,
      'column', pc.column_name,
      'policy', pc.policy_name
    ) AS metadata
  FROM policy_columns pc
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index i
    WHERE i.indrelid = pc.table_oid
      AND i.indisvalid
      AND pc.column_attnum = ANY(string_to_array(i.indkey::text, ' ')::smallint[])
  )
  ORDER BY pc.schema_name, pc.table_name, pc.column_name, pc.policy_name
`;

export const missingRlsIndexRule: AdvisorRule = {
  id: 'missing-rls-index',
  category: 'performance',
  severity: 'warning',
  title: 'Missing RLS Index',
  description: 'Detects RLS policy filter columns that do not have an index.',
  run: (executor) => runSqlRule(missingRlsIndexRule, executor, sql),
};
