import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import type { AdvisorRuleId } from '@insforge/shared-schemas';

vi.mock('@/infra/database/database.manager.js', () => ({
  DatabaseManager: {
    getInstance: () => ({ getPool: () => mockPool }),
  },
}));

let mockPool: Pool;
let mockClient: PoolClient;
let rowsByRule: Partial<Record<AdvisorRuleId, unknown[]>>;
let pgStatStatementsExists = false;
let holdRlsDisabledQuery: (() => void) | null = null;
let executedSql: string[];

const expectedRuleIds: AdvisorRuleId[] = [
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
];

const sampleRowsByRule: Record<AdvisorRuleId, unknown[]> = {
  'rls-disabled': [{ schema_name: 'public', table_name: 'profiles' }],
  'rls-permissive': [
    {
      schema_name: 'public',
      table_name: 'profiles',
      object_name: 'profiles_select',
      cmd: 'r',
      roles: ['authenticated'],
    },
  ],
  'rls-no-policy': [{ schema_name: 'public', table_name: 'orders' }],
  'dangerous-function': [
    {
      schema_name: 'public',
      object_name: 'admin_escalate',
      argument_types: 'user_id uuid',
      callable_roles: ['authenticated'],
    },
  ],
  'rls-select-only': [{ schema_name: 'public', table_name: 'messages', select_policy_count: 1 }],
  'missing-fk-index': [
    {
      schema_name: 'public',
      table_name: 'comments',
      object_name: 'comments_post_id_fkey',
      columns: ['post_id'],
      referenced_table: 'public.posts',
    },
  ],
  'unused-index': [
    {
      schema_name: 'public',
      table_name: 'events',
      object_name: 'events_unused_idx',
      index_size_bytes: '8192',
      idx_scan: '0',
    },
  ],
  'slow-query': [
    {
      object_name: '42',
      mean_exec_time: '1250',
      calls: '3',
      query: 'select pg_sleep(2)',
    },
  ],
  'connection-high': [{ used_connections: '80', max_connections: '100', usage_ratio: '0.8' }],
  'connection-critical': [{ used_connections: '96', max_connections: '100', usage_ratio: '0.96' }],
  'idle-in-transaction': [
    {
      object_name: '101',
      duration_seconds: '400',
      application_name: 'psql',
      query: 'select 1',
    },
  ],
  'low-cache-hit-ratio': [
    { datname: 'insforge', cache_hit_ratio: '0.95', blks_read: '50', blks_hit: '950' },
  ],
  'long-running-query': [
    {
      object_name: '202',
      duration_seconds: '500',
      application_name: 'api',
      query: 'select slow()',
    },
  ],
  'rls-policy-perf': [
    {
      schema_name: 'public',
      table_name: 'profiles',
      object_name: 'profiles_owner',
      expression: 'user_id = auth.uid()',
    },
  ],
  'missing-rls-index': [
    {
      schema_name: 'public',
      table_name: 'profiles',
      object_name: 'user_id',
      expression: 'user_id = auth.uid()',
    },
  ],
  'dead-tuples': [
    {
      schema_name: 'public',
      table_name: 'events',
      n_dead_tup: '5000',
      n_live_tup: '10000',
      dead_tuple_ratio: '0.333',
    },
  ],
  'stale-statistics': [
    {
      schema_name: 'public',
      table_name: 'events',
      n_mod_since_analyze: '4000',
      last_analyze: null,
      last_autoanalyze: null,
    },
  ],
  'sequence-exhaustion': [
    {
      schema_name: 'public',
      object_name: 'events_id_seq',
      last_value: '90',
      start_value: '1',
      min_value: '1',
      max_value: '100',
      increment_by: '1',
      percent_used: '0.9',
    },
  ],
  'autovacuum-blocked': [
    {
      object_name: '303',
      duration_seconds: '600',
      wait_event: 'relation',
      query: 'autovacuum: VACUUM public.events',
    },
  ],
};

function findRuleMarker(sql: string): AdvisorRuleId | null {
  for (const ruleId of expectedRuleIds) {
    if (sql.includes(`advisor:${ruleId}`)) {
      return ruleId;
    }
  }
  return null;
}

async function handleQuery(sqlInput: string) {
  const sql = String(sqlInput);
  executedSql.push(sql);

  if (sql.includes('SELECT to_regclass($1) IS NOT NULL')) {
    return { rows: [{ exists: pgStatStatementsExists }], rowCount: 1 };
  }

  const ruleId = findRuleMarker(sql);
  if (ruleId === 'rls-disabled' && holdRlsDisabledQuery) {
    await new Promise<void>((resolve) => {
      holdRlsDisabledQuery = resolve;
    });
  }

  if (!ruleId) {
    return { rows: [], rowCount: 0 };
  }

  const rows = rowsByRule[ruleId] ?? [];
  return { rows, rowCount: rows.length };
}

function makeMockClient(): PoolClient {
  return {
    query: vi.fn(handleQuery),
    release: vi.fn(),
  } as unknown as PoolClient;
}

function makeMockPool(): Pool {
  return {
    connect: vi.fn(async () => mockClient),
    query: vi.fn(handleQuery),
  } as unknown as Pool;
}

async function loadService() {
  vi.resetModules();
  const module = await import('@/services/advisor/advisor.service.js');
  return module.AdvisorService.getInstance();
}

describe('AdvisorService', () => {
  beforeEach(() => {
    rowsByRule = {};
    pgStatStatementsExists = false;
    holdRlsDisabledQuery = null;
    executedSql = [];
    mockClient = makeMockClient();
    mockPool = makeMockPool();
  });

  it('registers the 19 advisor rules from the issue', async () => {
    const { ADVISOR_RULES } = await import('@/services/advisor/advisor.service.js');
    expect(ADVISOR_RULES.map((rule) => rule.ruleId)).toEqual(expectedRuleIds);
  });

  it.each(expectedRuleIds)(
    'returns a finding for %s when the catalog query matches',
    async (ruleId) => {
      rowsByRule = { [ruleId]: sampleRowsByRule[ruleId] };
      pgStatStatementsExists = ruleId === 'slow-query';
      const service = await loadService();

      const result = await service.scan();

      expect(result.findings.map((finding) => finding.ruleId)).toEqual([ruleId]);
      expect(result.findingCount).toBe(1);
      expect(result.rules).toHaveLength(19);
    }
  );

  it('returns an empty scan when no rules match', async () => {
    const service = await loadService();

    const result = await service.scan();

    expect(result.findingCount).toBe(0);
    expect(result.findings).toEqual([]);
    expect(result.summary).toEqual({
      security: 0,
      performance: 0,
      health: 0,
      critical: 0,
      warning: 0,
      info: 0,
    });
  });

  it('rejects overlapping scans with an in-memory lock', async () => {
    rowsByRule = { 'rls-disabled': sampleRowsByRule['rls-disabled'] };
    holdRlsDisabledQuery = () => {};
    const service = await loadService();

    const firstScan = service.scan();
    await expect(service.scan()).rejects.toThrow(/already running/);

    holdRlsDisabledQuery?.();
    await expect(firstScan).resolves.toMatchObject({ findingCount: 1 });
  });

  it('scopes slow-query to the current database', async () => {
    rowsByRule = { 'slow-query': sampleRowsByRule['slow-query'] };
    pgStatStatementsExists = true;
    const service = await loadService();

    await service.scan();

    const slowQuerySql = executedSql.find((sql) => sql.includes('advisor:slow-query')) ?? '';
    expect(slowQuerySql).toContain(
      'dbid = (SELECT oid FROM pg_database WHERE datname = current_database())'
    );
  });

  it('counts only other client backends for connection pressure rules', async () => {
    rowsByRule = {
      'connection-high': sampleRowsByRule['connection-high'],
      'connection-critical': sampleRowsByRule['connection-critical'],
    };
    const service = await loadService();

    await service.scan();

    for (const ruleId of ['connection-high', 'connection-critical']) {
      const sql = executedSql.find((query) => query.includes(`advisor:${ruleId}`)) ?? '';
      expect(sql).toContain("backend_type = 'client backend'");
      expect(sql).toContain('pid <> pg_backend_pid()');
    }
  });

  it('uses whole-identifier matching for missing RLS index detection', async () => {
    rowsByRule = { 'missing-rls-index': sampleRowsByRule['missing-rls-index'] };
    const service = await loadService();

    await service.scan();

    const sql = executedSql.find((query) => query.includes('advisor:missing-rls-index')) ?? '';
    expect(sql).toContain("~* ('\\m' || a.attname || '\\M')");
    expect(sql).not.toContain("ILIKE '%' || a.attname || '%'");
  });

  it('gives overloaded dangerous functions distinct finding IDs', async () => {
    rowsByRule = {
      'dangerous-function': [
        sampleRowsByRule['dangerous-function'][0],
        {
          schema_name: 'public',
          object_name: 'admin_escalate',
          argument_types: 'email text',
          callable_roles: ['authenticated'],
        },
      ],
    };
    const service = await loadService();

    const result = await service.scan();

    expect(new Set(result.findings.map((finding) => finding.id)).size).toBe(2);
  });

  it('uses sequence bounds and increment direction for sequence exhaustion', async () => {
    rowsByRule = { 'sequence-exhaustion': sampleRowsByRule['sequence-exhaustion'] };
    const service = await loadService();

    const result = await service.scan();

    const sql = executedSql.find((query) => query.includes('advisor:sequence-exhaustion')) ?? '';
    expect(sql).toContain('increment_by > 0');
    expect(sql).toContain('max_value::numeric - start_value::numeric');
    expect(sql).toContain('start_value::numeric - min_value::numeric');
    expect(result.findings[0]?.detail).toMatchObject({
      startValue: 1,
      minValue: 1,
      maxValue: 100,
      incrementBy: 1,
      percentUsed: 0.9,
    });
  });
});
