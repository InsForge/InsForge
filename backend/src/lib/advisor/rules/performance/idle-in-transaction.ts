import type { AdvisorRule } from '@/lib/advisor/types.js';
import { runSqlRule } from '../helpers.js';

const sql = `
  SELECT
    format('pid %s', pid) AS affected_object,
    format(
      'Session %s has been idle in transaction for %s.',
      pid,
      now() - state_change
    ) AS detail,
    'Find the client holding the transaction open and commit, rollback, or terminate it.' AS recommendation,
    jsonb_build_object(
      'pid', pid,
      'usename', usename,
      'application_name', application_name,
      'client_addr', client_addr,
      'state_change', state_change,
      'query', query
    ) AS metadata
  FROM pg_catalog.pg_stat_activity
  WHERE state = 'idle in transaction'
    AND now() - state_change > interval '5 minutes'
    AND pid <> pg_backend_pid()
  ORDER BY state_change ASC
`;

export const idleInTransactionRule: AdvisorRule = {
  id: 'idle-in-transaction',
  category: 'performance',
  severity: 'warning',
  title: 'Idle In Transaction',
  description: 'Detects sessions stuck idle inside an open transaction.',
  run: (executor) => runSqlRule(idleInTransactionRule, executor, sql),
};
