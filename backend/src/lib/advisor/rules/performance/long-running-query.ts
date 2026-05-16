import type { AdvisorRule } from '@/lib/advisor/types.js';
import { runSqlRule } from '../helpers.js';

const sql = `
  SELECT
    format('pid %s', pid) AS affected_object,
    format(
      'Query in session %s has been running for %s.',
      pid,
      now() - query_start
    ) AS detail,
    'Inspect the query plan and consider cancelling the query if it is blocking production work.' AS recommendation,
    jsonb_build_object(
      'pid', pid,
      'usename', usename,
      'application_name', application_name,
      'client_addr', client_addr,
      'query_start', query_start,
      'wait_event_type', wait_event_type,
      'wait_event', wait_event,
      'query', query
    ) AS metadata
  FROM pg_catalog.pg_stat_activity
  WHERE state = 'active'
    AND query_start IS NOT NULL
    AND now() - query_start > interval '5 minutes'
    AND pid <> pg_backend_pid()
  ORDER BY query_start ASC
`;

export const longRunningQueryRule: AdvisorRule = {
  id: 'long-running-query',
  category: 'performance',
  severity: 'warning',
  title: 'Long Running Query',
  description: 'Detects active queries running longer than five minutes.',
  run: (executor) => runSqlRule(longRunningQueryRule, executor, sql),
};
