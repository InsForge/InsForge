import type { AdvisorRule } from '@/lib/advisor/types.js';
import { autovacuumBlockedRule } from './health/autovacuum-blocked.js';
import { deadTuplesRule } from './health/dead-tuples.js';
import { sequenceExhaustionRule } from './health/sequence-exhaustion.js';
import { staleStatisticsRule } from './health/stale-statistics.js';
import { connectionCriticalRule } from './performance/connection-critical.js';
import { connectionHighRule } from './performance/connection-high.js';
import { idleInTransactionRule } from './performance/idle-in-transaction.js';
import { longRunningQueryRule } from './performance/long-running-query.js';
import { lowCacheHitRatioRule } from './performance/low-cache-hit-ratio.js';
import { missingFkIndexRule } from './performance/missing-fk-index.js';
import { missingRlsIndexRule } from './performance/missing-rls-index.js';
import { rlsPolicyPerfRule } from './performance/rls-policy-perf.js';
import { slowQueryRule } from './performance/slow-query.js';
import { unusedIndexRule } from './performance/unused-index.js';
import { dangerousFunctionRule } from './security/dangerous-function.js';
import { rlsDisabledRule } from './security/rls-disabled.js';
import { rlsNoPolicyRule } from './security/rls-no-policy.js';
import { rlsPermissiveRule } from './security/rls-permissive.js';
import { rlsSelectOnlyRule } from './security/rls-select-only.js';

export const advisorRules: AdvisorRule[] = [
  rlsDisabledRule,
  rlsPermissiveRule,
  rlsNoPolicyRule,
  dangerousFunctionRule,
  rlsSelectOnlyRule,
  missingFkIndexRule,
  unusedIndexRule,
  slowQueryRule,
  connectionHighRule,
  connectionCriticalRule,
  idleInTransactionRule,
  lowCacheHitRatioRule,
  longRunningQueryRule,
  rlsPolicyPerfRule,
  missingRlsIndexRule,
  deadTuplesRule,
  staleStatisticsRule,
  sequenceExhaustionRule,
  autovacuumBlockedRule,
];
