import type { AdvisorRule } from '@/lib/advisor/types.js';
import { runSqlRule } from '../helpers.js';

const sql = `
  SELECT
    coalesce(lock_relation.relation_name, format('pid %s', a.pid)) AS affected_object,
    format(
      'Autovacuum worker %s is waiting on %s.',
      a.pid,
      coalesce(a.wait_event, 'a lock')
    ) AS detail,
    'Find and resolve the blocking session so autovacuum can complete.' AS recommendation,
    jsonb_build_object(
      'pid', a.pid,
      'query', a.query,
      'wait_event_type', a.wait_event_type,
      'wait_event', a.wait_event,
      'relation', lock_relation.relation_name,
      'state', a.state
    ) AS metadata
  FROM pg_catalog.pg_stat_activity a
  LEFT JOIN LATERAL (
    SELECT l.relation::regclass::text AS relation_name
    FROM pg_catalog.pg_locks l
    WHERE l.pid = a.pid
      AND l.relation IS NOT NULL
    ORDER BY l.granted ASC
    LIMIT 1
  ) lock_relation ON true
  WHERE a.query ILIKE 'autovacuum:%'
    AND (
      a.wait_event_type = 'Lock'
      OR EXISTS (
        SELECT 1
        FROM pg_catalog.pg_locks blocked_lock
        WHERE blocked_lock.pid = a.pid
          AND NOT blocked_lock.granted
      )
    )
  ORDER BY a.query_start ASC NULLS LAST
`;

export const autovacuumBlockedRule: AdvisorRule = {
  id: 'autovacuum-blocked',
  category: 'health',
  severity: 'critical',
  title: 'Autovacuum Blocked',
  description: 'Detects autovacuum workers blocked while trying to maintain a table.',
  run: (executor) => runSqlRule(autovacuumBlockedRule, executor, sql),
};
