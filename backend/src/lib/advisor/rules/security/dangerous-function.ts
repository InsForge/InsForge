import type { AdvisorRule } from '@/lib/advisor/types.js';
import { runSqlRule } from '../helpers.js';

const sql = `
  SELECT
    format('%I.%I(%s)', n.nspname, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid)) AS affected_object,
    format(
      'Function %I.%I(%s) does not set search_path, so it uses the caller/session search path.',
      n.nspname,
      p.proname,
      pg_catalog.pg_get_function_identity_arguments(p.oid)
    ) AS detail,
    'Set a fixed search_path on the function, for example ALTER FUNCTION ... SET search_path = public, pg_temp.' AS recommendation,
    jsonb_build_object(
      'schema', n.nspname,
      'function', p.proname,
      'arguments', pg_catalog.pg_get_function_identity_arguments(p.oid),
      'security_definer', p.prosecdef
    ) AS metadata
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n
    ON n.oid = p.pronamespace
  LEFT JOIN pg_catalog.pg_depend dep
    ON dep.objid = p.oid
    AND dep.deptype = 'e'
  WHERE n.nspname = 'public'
    AND dep.objid IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(coalesce(p.proconfig, '{}')) AS config
      WHERE config LIKE 'search_path=%'
    )
  ORDER BY n.nspname, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid)
`;

export const dangerousFunctionRule: AdvisorRule = {
  id: 'dangerous-function',
  category: 'security',
  severity: 'warning',
  title: 'Function Search Path Mutable',
  description: 'Functions should set an explicit search_path to avoid search path hijacking risks.',
  run: (executor) => runSqlRule(dangerousFunctionRule, executor, sql),
};
