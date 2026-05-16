import type { AdvisorRule } from '@/lib/advisor/types.js';
import { runSqlRule } from '../helpers.js';

const sql = `
  WITH foreign_keys AS (
    SELECT
      n.nspname AS schema_name,
      cl.relname AS table_name,
      cl.oid AS table_oid,
      ct.conname AS fkey_name,
      ct.conkey AS col_attnums
    FROM pg_catalog.pg_constraint ct
    JOIN pg_catalog.pg_class cl
      ON ct.conrelid = cl.oid
    JOIN pg_catalog.pg_namespace n
      ON n.oid = cl.relnamespace
    LEFT JOIN pg_catalog.pg_depend dep
      ON dep.objid = cl.oid
      AND dep.deptype = 'e'
    WHERE ct.contype = 'f'
      AND n.nspname = 'public'
      AND dep.objid IS NULL
  ),
  valid_indexes AS (
    SELECT
      pi.indrelid AS table_oid,
      pi.indexrelid,
      string_to_array(pi.indkey::text, ' ')::smallint[] AS col_attnums
    FROM pg_catalog.pg_index pi
    WHERE pi.indisvalid
  )
  SELECT
    format('%I.%I', fk.schema_name, fk.table_name) AS affected_object,
    format('Table %I.%I has foreign key %I without a covering index.', fk.schema_name, fk.table_name, fk.fkey_name) AS detail,
    'Create an index whose leading columns match the foreign key columns.' AS recommendation,
    jsonb_build_object(
      'schema', fk.schema_name,
      'table', fk.table_name,
      'foreign_key', fk.fkey_name,
      'column_attnums', fk.col_attnums
    ) AS metadata
  FROM foreign_keys fk
  LEFT JOIN valid_indexes idx
    ON idx.table_oid = fk.table_oid
    AND fk.col_attnums = idx.col_attnums[1:array_length(fk.col_attnums, 1)]
  WHERE idx.indexrelid IS NULL
  ORDER BY fk.schema_name, fk.table_name, fk.fkey_name
`;

export const missingFkIndexRule: AdvisorRule = {
  id: 'missing-fk-index',
  category: 'performance',
  severity: 'info',
  title: 'Missing Foreign Key Index',
  description:
    'Foreign key columns should have a covering index for joins and deletes on referenced rows.',
  run: (executor) => runSqlRule(missingFkIndexRule, executor, sql),
};
