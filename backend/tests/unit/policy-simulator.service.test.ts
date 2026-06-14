import { describe, it, expect } from 'vitest';
import {
  simulatePolicyRequestSchema,
  type SimulatePolicyResponse,
  type SimulatorPolicy,
} from '@insforge/shared-schemas';
import {
  mergeClaims,
  buildWhereClause,
  classifySelect,
  classifyMutation,
  buildExplanation,
  buildExampleQuery,
} from '@/services/database/policy-simulator.service.js';

describe('simulatePolicyRequestSchema', () => {
  it('accepts a minimal valid request', () => {
    const parsed = simulatePolicyRequestSchema.safeParse({
      table: 'todos',
      operation: 'SELECT',
      role: 'authenticated',
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts custom claims, row, match, and sampleLimit', () => {
    const parsed = simulatePolicyRequestSchema.safeParse({
      schema: 'public',
      table: 'todos',
      operation: 'UPDATE',
      role: 'authenticated',
      claims: { sub: 'u1', org_id: 'acme' },
      row: { done: true },
      match: { user_id: 'u1' },
      sampleLimit: 10,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an unknown operation', () => {
    expect(
      simulatePolicyRequestSchema.safeParse({
        table: 'todos',
        operation: 'TRUNCATE',
        role: 'authenticated',
      }).success
    ).toBe(false);
  });

  it('rejects an unknown role', () => {
    expect(
      simulatePolicyRequestSchema.safeParse({
        table: 'todos',
        operation: 'SELECT',
        role: 'superuser',
      }).success
    ).toBe(false);
  });

  it('rejects a missing table', () => {
    expect(
      simulatePolicyRequestSchema.safeParse({ operation: 'SELECT', role: 'anon' }).success
    ).toBe(false);
  });

  it('rejects a sampleLimit above the cap', () => {
    expect(
      simulatePolicyRequestSchema.safeParse({
        table: 'todos',
        operation: 'SELECT',
        role: 'anon',
        sampleLimit: 1000,
      }).success
    ).toBe(false);
  });
});

describe('mergeClaims', () => {
  it('injects the simulated role', () => {
    expect(mergeClaims('authenticated', { sub: 'u1' })).toEqual({
      sub: 'u1',
      role: 'authenticated',
    });
  });

  it('keeps custom claims like org_id', () => {
    expect(mergeClaims('authenticated', { sub: 'u1', org_id: 'acme' })).toEqual({
      sub: 'u1',
      org_id: 'acme',
      role: 'authenticated',
    });
  });

  it('never lets a custom role claim override the simulated role', () => {
    expect(mergeClaims('anon', { role: 'project_admin', sub: 'u1' })).toEqual({
      role: 'anon',
      sub: 'u1',
    });
  });

  it('handles missing claims', () => {
    expect(mergeClaims('project_admin', undefined)).toEqual({ role: 'project_admin' });
  });
});

describe('buildWhereClause', () => {
  it('returns empty for no match', () => {
    expect(buildWhereClause(undefined)).toEqual({ sql: '', params: [] });
    expect(buildWhereClause({})).toEqual({ sql: '', params: [] });
  });

  it('parameterizes values and quotes identifiers', () => {
    const { sql, params } = buildWhereClause({ user_id: 'u1', done: true });
    expect(sql).toBe('WHERE "user_id" = $1 AND "done" = $2');
    expect(params).toEqual(['u1', true]);
  });

  it('renders null as IS NULL without a parameter', () => {
    const { sql, params } = buildWhereClause({ deleted_at: null, id: 5 });
    expect(sql).toBe('WHERE "deleted_at" IS NULL AND "id" = $1');
    expect(params).toEqual([5]);
  });

  it('honors a custom start index (for combining with a SET clause)', () => {
    const { sql, params } = buildWhereClause({ user_id: 'u1' }, 3);
    expect(sql).toBe('WHERE "user_id" = $3');
    expect(params).toEqual(['u1']);
  });

  it('rejects identifiers with quotes or control characters', () => {
    expect(() => buildWhereClause({ 'evil"col': 1 })).toThrow();
  });
});

describe('classifySelect', () => {
  it('reports bypass for BYPASSRLS roles', () => {
    expect(classifySelect({ rowsVisible: 3, rowsTotal: 3, bypassRls: true })).toBe('bypass');
  });
  it('allowed when the role sees every row', () => {
    expect(classifySelect({ rowsVisible: 3, rowsTotal: 3, bypassRls: false })).toBe('allowed');
  });
  it('partial when the role sees some rows', () => {
    expect(classifySelect({ rowsVisible: 1, rowsTotal: 3, bypassRls: false })).toBe('partial');
  });
  it('denied when the role sees no rows but rows exist', () => {
    expect(classifySelect({ rowsVisible: 0, rowsTotal: 3, bypassRls: false })).toBe('denied');
  });
  it('allowed (not denied) when the table is empty', () => {
    expect(classifySelect({ rowsVisible: 0, rowsTotal: 0, bypassRls: false })).toBe('allowed');
  });
});

describe('classifyMutation', () => {
  it('reports bypass for BYPASSRLS roles', () => {
    expect(classifyMutation({ rowsAffected: 2, rowsTotal: 2, bypassRls: true })).toBe('bypass');
  });
  it('allowed when every matching row is affected', () => {
    expect(classifyMutation({ rowsAffected: 2, rowsTotal: 2, bypassRls: false })).toBe('allowed');
  });
  it('partial when only some matching rows are affected', () => {
    expect(classifyMutation({ rowsAffected: 1, rowsTotal: 2, bypassRls: false })).toBe('partial');
  });
  it('denied when matching rows exist but none are affected', () => {
    expect(classifyMutation({ rowsAffected: 0, rowsTotal: 2, bypassRls: false })).toBe('denied');
  });
  it('allowed when there are no matching rows to act on', () => {
    expect(classifyMutation({ rowsAffected: 0, rowsTotal: 0, bypassRls: false })).toBe('allowed');
  });
});

function baseResult(overrides: Partial<SimulatePolicyResponse>): SimulatePolicyResponse {
  return {
    schema: 'public',
    table: 'todos',
    operation: 'SELECT',
    role: 'authenticated',
    effectiveClaims: { role: 'authenticated', sub: 'u1' },
    rlsEnabled: true,
    bypassRls: false,
    decision: 'allowed',
    rowsVisible: 1,
    rowsTotal: 1,
    rowsAffected: null,
    sampleRows: null,
    denialReason: null,
    applicablePolicies: [],
    explanation: '',
    exampleQuery: '',
    ...overrides,
  };
}

const ownerSelect: SimulatorPolicy = {
  tableName: 'todos',
  policyName: 'owner_select',
  cmd: 'SELECT',
  roles: ['authenticated'],
  qual: '(auth.uid() = user_id)',
  withCheck: null,
  permissive: true,
};

describe('buildExplanation', () => {
  it('explains BYPASSRLS for project_admin', () => {
    const text = buildExplanation(
      baseResult({ role: 'project_admin', bypassRls: true, decision: 'bypass' })
    );
    expect(text).toContain('BYPASSRLS');
  });

  it('explains a denied BYPASSRLS role as a missing GRANT, not full access', () => {
    const text = buildExplanation(
      baseResult({
        role: 'project_admin',
        bypassRls: true,
        decision: 'denied',
        denialReason: 'permission denied for table todos',
      })
    );
    expect(text).toContain('GRANT');
    expect(text).not.toContain('full table access');
  });

  it('notes when RLS is not enabled', () => {
    const text = buildExplanation(baseResult({ rlsEnabled: false }));
    expect(text).toContain('not enabled');
    expect(text).toContain('GRANT');
  });

  it('flags default-deny when no policy applies', () => {
    const text = buildExplanation(
      baseResult({ decision: 'denied', rowsVisible: 0, rowsTotal: 3, applicablePolicies: [] })
    );
    expect(text).toContain('No RLS policy');
  });

  it('summarizes permissive policy combination on allow', () => {
    const text = buildExplanation(
      baseResult({ decision: 'allowed', applicablePolicies: [ownerSelect] })
    );
    expect(text).toContain('allowed');
    expect(text).toContain('OR');
  });

  it('reports the denial reason when present', () => {
    const text = buildExplanation(
      baseResult({
        decision: 'denied',
        rowsVisible: 0,
        rowsTotal: 3,
        denialReason: 'new row violates row-level security policy',
        applicablePolicies: [ownerSelect],
      })
    );
    expect(text).toContain('violates row-level security');
  });
});

describe('buildExampleQuery', () => {
  it('produces a runnable, rolled-back snippet with role and claims', () => {
    const snippet = buildExampleQuery(
      baseResult({ role: 'authenticated', effectiveClaims: { role: 'authenticated', sub: 'u1' } }),
      '"public"."todos"'
    );
    expect(snippet).toContain('SET LOCAL ROLE authenticated;');
    expect(snippet).toContain("set_config('request.jwt.claims'");
    expect(snippet).toContain('"public"."todos"');
    expect(snippet.startsWith('BEGIN;')).toBe(true);
    expect(snippet.trimEnd().endsWith('ROLLBACK;')).toBe(true);
  });

  it('escapes single quotes in the claims JSON', () => {
    const snippet = buildExampleQuery(
      baseResult({ effectiveClaims: { role: 'authenticated', note: "o'brien" } }),
      '"public"."todos"'
    );
    expect(snippet).toContain("o''brien");
  });
});
