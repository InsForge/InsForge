import { describe, expect, it } from 'vitest';
import { advisorRules } from '../../src/lib/advisor/rules/index.js';

describe('advisor rule registry', () => {
  it('registers the expected 19 advisor rules in issue order', () => {
    expect(advisorRules.map((rule) => rule.id)).toEqual([
      'rls-disabled',
      'rls-permissive',
      'rls-no-policy',
      'dangerous-function',
      'rls-select-only',
      'missing-fk-index',
      'unused-index',
      'slow-query',
      'connection-high',
      'connection-critical',
      'idle-in-transaction',
      'low-cache-hit-ratio',
      'long-running-query',
      'rls-policy-perf',
      'missing-rls-index',
      'dead-tuples',
      'stale-statistics',
      'sequence-exhaustion',
      'autovacuum-blocked',
    ]);
  });

  it('assigns each rule to the expected advisor category', () => {
    expect(advisorRules.map((rule) => [rule.id, rule.category])).toEqual([
      ['rls-disabled', 'security'],
      ['rls-permissive', 'security'],
      ['rls-no-policy', 'security'],
      ['dangerous-function', 'security'],
      ['rls-select-only', 'security'],
      ['missing-fk-index', 'performance'],
      ['unused-index', 'performance'],
      ['slow-query', 'performance'],
      ['connection-high', 'performance'],
      ['connection-critical', 'performance'],
      ['idle-in-transaction', 'performance'],
      ['low-cache-hit-ratio', 'performance'],
      ['long-running-query', 'performance'],
      ['rls-policy-perf', 'performance'],
      ['missing-rls-index', 'performance'],
      ['dead-tuples', 'health'],
      ['stale-statistics', 'health'],
      ['sequence-exhaustion', 'health'],
      ['autovacuum-blocked', 'health'],
    ]);
  });
});
