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
    expect(
      classifySelect({
        rowsVisible: 3,
        rowsTotal: 3,
        bypassRls: true,
        rlsEnabled: true,
        applicablePermissiveCount: 0,
      })
    ).toBe('bypass');
  });
  it('allowed when the role sees every row', () => {
    expect(
      classifySelect({
        rowsVisible: 3,
        rowsTotal: 3,
        bypassRls: false,
        rlsEnabled: true,
        applicablePermissiveCount: 1,
      })
    ).toBe('allowed');
  });
  it('partial when the role sees some rows', () => {
    expect(
      classifySelect({
        rowsVisible: 1,
        rowsTotal: 3,
        bypassRls: false,
        rlsEnabled: true,
        applicablePermissiveCount: 1,
      })
    ).toBe('partial');
  });
  it('denied when the role sees no rows but rows exist', () => {
    expect(
      classifySelect({
        rowsVisible: 0,
        rowsTotal: 3,
        bypassRls: false,
        rlsEnabled: true,
        applicablePermissiveCount: 0,
      })
    ).toBe('denied');
  });
  it('denied (default-deny) on an empty table when no permissive policy applies', () => {
    expect(
      classifySelect({
        rowsVisible: 0,
        rowsTotal: 0,
        bypassRls: false,
        rlsEnabled: true,
        applicablePermissiveCount: 0,
      })
    ).toBe('denied');
  });
  it('allowed (outcome unobserved) on an empty table when a permissive policy applies', () => {
    expect(
      classifySelect({
        rowsVisible: 0,
        rowsTotal: 0,
        bypassRls: false,
        rlsEnabled: true,
        applicablePermissiveCount: 1,
      })
    ).toBe('allowed');
  });
  it('allowed on an empty table when RLS is disabled (no policy can deny)', () => {
    expect(
      classifySelect({
        rowsVisible: 0,
        rowsTotal: 0,
        bypassRls: false,
        rlsEnabled: false,
        applicablePermissiveCount: 0,
      })
    ).toBe('allowed');
  });
  it('falls back to the role visibility when the admin baseline is null', () => {
    expect(
      classifySelect({
        rowsVisible: 2,
        rowsTotal: null,
        bypassRls: false,
        rlsEnabled: true,
        applicablePermissiveCount: 1,
      })
    ).toBe('allowed');
    expect(
      classifySelect({
        rowsVisible: 0,
        rowsTotal: null,
        bypassRls: false,
        rlsEnabled: true,
        applicablePermissiveCount: 0,
      })
    ).toBe('denied');
  });
});

describe('classifyMutation', () => {
  it('reports bypass for BYPASSRLS roles', () => {
    expect(
      classifyMutation({
        rowsAffected: 2,
        rowsTotal: 2,
        bypassRls: true,
        rlsEnabled: true,
        applicablePermissiveCount: 0,
      })
    ).toBe('bypass');
  });
  it('allowed when every matching row is affected', () => {
    expect(
      classifyMutation({
        rowsAffected: 2,
        rowsTotal: 2,
        bypassRls: false,
        rlsEnabled: true,
        applicablePermissiveCount: 1,
      })
    ).toBe('allowed');
  });
  it('partial when only some matching rows are affected', () => {
    expect(
      classifyMutation({
        rowsAffected: 1,
        rowsTotal: 2,
        bypassRls: false,
        rlsEnabled: true,
        applicablePermissiveCount: 1,
      })
    ).toBe('partial');
  });
  it('denied when matching rows exist but none are affected', () => {
    expect(
      classifyMutation({
        rowsAffected: 0,
        rowsTotal: 2,
        bypassRls: false,
        rlsEnabled: true,
        applicablePermissiveCount: 0,
      })
    ).toBe('denied');
  });
  it('denied (default-deny) on an empty match when no permissive policy applies', () => {
    expect(
      classifyMutation({
        rowsAffected: 0,
        rowsTotal: 0,
        bypassRls: false,
        rlsEnabled: true,
        applicablePermissiveCount: 0,
      })
    ).toBe('denied');
  });
  it('allowed (outcome unobserved) on an empty match when a permissive policy applies', () => {
    expect(
      classifyMutation({
        rowsAffected: 0,
        rowsTotal: 0,
        bypassRls: false,
        rlsEnabled: true,
        applicablePermissiveCount: 1,
      })
    ).toBe('allowed');
  });
  it('allowed on an empty match when RLS is disabled (no policy can deny)', () => {
    expect(
      classifyMutation({
        rowsAffected: 0,
        rowsTotal: 0,
        bypassRls: false,
        rlsEnabled: false,
        applicablePermissiveCount: 0,
      })
    ).toBe('allowed');
  });
  it('falls back to rows affected when the admin baseline is null', () => {
    expect(
      classifyMutation({
        rowsAffected: 1,
        rowsTotal: null,
        bypassRls: false,
        rlsEnabled: true,
        applicablePermissiveCount: 1,
      })
    ).toBe('allowed');
    expect(
      classifyMutation({
        rowsAffected: 0,
        rowsTotal: null,
        bypassRls: false,
        rlsEnabled: true,
        applicablePermissiveCount: 0,
      })
    ).toBe('denied');
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

// A restrictive policy with NO accompanying permissive policy: RLS is
// permissive-OR, so this configuration denies every row for the role.
const restrictiveSelect: SimulatorPolicy = {
  tableName: 'todos',
  policyName: 'tenant_restrict',
  cmd: 'SELECT',
  roles: ['authenticated'],
  qual: "(tenant_id = current_setting('app.tenant', true))",
  withCheck: null,
  permissive: false,
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

  it('distinguishes a missing GRANT denial from an RLS policy denial', () => {
    const text = buildExplanation(
      baseResult({
        decision: 'denied',
        rowsVisible: 0,
        rowsTotal: 3,
        denialReason: 'permission denied for table todos',
        applicablePolicies: [],
      })
    );
    expect(text).toContain('GRANT');
    expect(text).not.toContain('blocked by default');
  });

  it('notes when the admin baseline was unavailable', () => {
    const text = buildExplanation(
      baseResult({
        decision: 'allowed',
        rowsVisible: 2,
        rowsTotal: null,
        applicablePolicies: [ownerSelect],
      })
    );
    expect(text).toContain('Admin baseline unavailable');
  });

  it('does not claim a proven RLS denial when 0 rows + no baseline', () => {
    const text = buildExplanation(
      baseResult({
        decision: 'denied',
        rowsVisible: 0,
        rowsTotal: null,
        denialReason: null,
        applicablePolicies: [ownerSelect],
      })
    );
    expect(text).toMatch(/may be an empty table/i);
    expect(text).not.toContain('denied by RLS (no rows pass)');
  });

  it('prefers the RLS phrase over "permission denied" when both could match', () => {
    const text = buildExplanation(
      baseResult({
        decision: 'denied',
        rowsVisible: 0,
        rowsTotal: 3,
        denialReason: 'new row violates row-level security policy for table "todos"',
        applicablePolicies: [ownerSelect],
      })
    );
    expect(text).not.toContain('missing table privilege (GRANT)');
  });

  it('reports default-deny on an empty table when no permissive policy applies', () => {
    const text = buildExplanation(
      baseResult({
        decision: 'denied',
        rowsVisible: 0,
        rowsTotal: 0,
        applicablePolicies: [],
      })
    );
    expect(text).toMatch(/matched no rows/i);
    expect(text).not.toContain('is allowed');
    expect(text).toMatch(/no applicable permissive/i);
    expect(text).toContain('denied by default');
  });

  it('reports default-deny on an empty table with only a restrictive policy', () => {
    const text = buildExplanation(
      baseResult({
        decision: 'denied',
        rowsVisible: 0,
        rowsTotal: 0,
        applicablePolicies: [restrictiveSelect],
      })
    );
    expect(text).toMatch(/matched no rows/i);
    expect(text).toMatch(/no applicable permissive/i);
    expect(text).toContain('denied by default');
  });

  it('explains an empty table with a permissive policy without claiming a proven allow', () => {
    const text = buildExplanation(
      baseResult({
        decision: 'allowed',
        rowsVisible: 0,
        rowsTotal: 0,
        applicablePolicies: [ownerSelect],
      })
    );
    expect(text).toMatch(/matched no rows/i);
    expect(text).toMatch(/could not be observed/i);
    expect(text).toContain('OR'); // the permissive/restrictive combination rule still surfaces
  });
});

describe('buildExampleQuery', () => {
  it('produces a runnable, rolled-back session scaffold with role and claims', () => {
    const snippet = buildExampleQuery(
      baseResult({ role: 'authenticated', effectiveClaims: { role: 'authenticated', sub: 'u1' } }),
      '"public"."todos"'
    );
    expect(snippet.startsWith('BEGIN;')).toBe(true);
    expect(snippet).toContain('SET LOCAL ROLE authenticated;');
    expect(snippet).toContain("set_config('request.jwt.claims'");
    expect(snippet).toContain('"public"."todos"');
    expect(snippet.trimEnd().endsWith('ROLLBACK;')).toBe(true);
  });

  it('dollar-quotes claims so single quotes are not doubled (no escaping needed)', () => {
    const snippet = buildExampleQuery(
      baseResult({ effectiveClaims: { role: 'authenticated', note: "o'brien" } }),
      '"public"."todos"'
    );
    expect(snippet).toContain("o'brien"); // verbatim, inside a dollar-quoted literal
    expect(snippet).not.toContain("o''brien");
    expect(snippet).toMatch(/set_config\('request\.jwt\.claims', \$\$.*\$\$, true\)/);
  });

  it('falls back to a collision-free dollar tag when a value contains $$', () => {
    const snippet = buildExampleQuery(
      baseResult({ effectiveClaims: { role: 'authenticated', x: 'a$$b' } }),
      '"public"."todos"'
    );
    expect(snippet).toContain('$q1$');
    expect(snippet).toContain('a$$b');
  });

  it('backfills the SELECT filter and sample limit', () => {
    const snippet = buildExampleQuery(baseResult({ operation: 'SELECT' }), '"public"."todos"', {
      match: { user_id: 'u1', done: true },
      sampleLimit: 3,
    });
    expect(snippet).toContain(
      'SELECT * FROM "public"."todos" WHERE "user_id" = $$u1$$ AND "done" = true LIMIT 3;'
    );
  });

  it('renders a real INSERT with columns and literal values', () => {
    const snippet = buildExampleQuery(baseResult({ operation: 'INSERT' }), '"public"."todos"', {
      row: { user_id: 'u1', title: 'hi', done: false },
    });
    expect(snippet).toContain(
      'INSERT INTO "public"."todos" ("user_id", "title", "done") VALUES ($$u1$$, $$hi$$, false);'
    );
  });

  it('renders a real UPDATE with SET and WHERE', () => {
    const snippet = buildExampleQuery(baseResult({ operation: 'UPDATE' }), '"public"."todos"', {
      row: { done: true },
      match: { user_id: 'u1' },
    });
    expect(snippet).toContain(
      'UPDATE "public"."todos" SET "done" = true WHERE "user_id" = $$u1$$;'
    );
  });

  it('renders a real DELETE with WHERE, and null match as IS NULL', () => {
    const snippet = buildExampleQuery(baseResult({ operation: 'DELETE' }), '"public"."todos"', {
      match: { archived_at: null },
    });
    expect(snippet).toContain('DELETE FROM "public"."todos" WHERE "archived_at" IS NULL;');
  });

  it('never emits an invalid literal for a non-finite value (defensive)', () => {
    // A non-finite number cannot arrive via a JSON request body; this guards the
    // display path so it renders NULL instead of a broken literal or a throw.
    const snippet = buildExampleQuery(baseResult({ operation: 'SELECT' }), '"public"."todos"', {
      match: { score: Number.POSITIVE_INFINITY } as Record<string, unknown>,
    });
    expect(snippet).toContain('"score" = NULL');
  });

  it('escapes a value ending in $ without breaking the dollar-quote (boundary)', () => {
    // A bare $$ tag would fuse with the trailing $ into $$SAVE20$$$ and close
    // early; the tag must escalate to a non-empty delimiter. Assert the FULL
    // literal so a malformed surrounding quote can't pass on a fragment match.
    const snippet = buildExampleQuery(baseResult({ operation: 'DELETE' }), '"public"."orders"', {
      match: { promo_code: 'SAVE20$' },
    });
    expect(snippet).toContain('WHERE "promo_code" = $q1$SAVE20$$q1$;');
  });

  it('escapes a lone $ value', () => {
    const snippet = buildExampleQuery(baseResult({ operation: 'DELETE' }), '"public"."orders"', {
      match: { code: '$' },
    });
    expect(snippet).toContain('WHERE "code" = $q1$$$q1$;');
  });

  it('reproduces a count(*) when sampling is disabled (sampleLimit 0)', () => {
    const snippet = buildExampleQuery(baseResult({ operation: 'SELECT' }), '"public"."todos"', {
      match: { user_id: 'u1' },
      sampleLimit: 0,
    });
    expect(snippet).toContain('SELECT count(*) FROM "public"."todos" WHERE "user_id" = $$u1$$;');
    expect(snippet).not.toContain('SELECT *');
  });

  it('renders DEFAULT VALUES for an INSERT with no row payload', () => {
    const snippet = buildExampleQuery(baseResult({ operation: 'INSERT' }), '"public"."todos"');
    expect(snippet).toContain('INSERT INTO "public"."todos" DEFAULT VALUES;');
  });

  it('emits a comment, never a broken statement, for an UPDATE with no row payload', () => {
    const snippet = buildExampleQuery(baseResult({ operation: 'UPDATE' }), '"public"."todos"');
    expect(snippet).toContain('-- UPDATE "public"."todos"');
    expect(snippet).not.toMatch(/UPDATE "public"\."todos" SET/);
  });

  it('renders an object value as a dollar-quoted JSON literal', () => {
    const snippet = buildExampleQuery(baseResult({ operation: 'INSERT' }), '"public"."todos"', {
      row: { meta: { a: 1, b: "it's" } },
    });
    expect(snippet).toContain('VALUES ($${"a":1,"b":"it\'s"}$$);');
  });
});
