import { ERROR_CODES } from '@insforge/shared-schemas';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// These tests run the real `deno check` (deno binary present in CI/dev). They
// prove the pre-deploy static check rejects the exact class of error that
// wedged project 2mn4wunc (issue #1594): a duplicate top-level declaration that
// builds fine but throws `Identifier '...' has already been declared` at
// isolate warm-up, surfacing only as the opaque "Event iterator validation
// failed".
describe('DenoSubhostingProvider.checkCode (pre-deploy static check)', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.DENO_DEPLOY_TOKEN = 't';
    process.env.DENO_DEPLOY_ORG_ID = 'o';
  });

  afterEach(() => {
    delete process.env.DENO_DEPLOY_TOKEN;
    delete process.env.DENO_DEPLOY_ORG_ID;
  });

  it('rejects a duplicate top-level declaration with a 400 + the offending identifier', async () => {
    const mod = await import('@/providers/functions/deno-subhosting.provider.js');
    const provider = mod.DenoSubhostingProvider.getInstance();

    // Reproduces dpo_agent.ts:122 from #1594: KILL_SWITCH_DOC_ID declared twice.
    const code = [
      'const KILL_SWITCH_DOC_ID = "global";',
      'export default function (_req: Request): Response {',
      '  return new Response(KILL_SWITCH_DOC_ID);',
      '}',
      'var KILL_SWITCH_DOC_ID = "global";',
    ].join('\n');

    await expect(provider.checkCode(code, 'dpo_agent')).rejects.toMatchObject({
      statusCode: 400,
      code: ERROR_CODES.INVALID_INPUT,
    });

    // And the message must name the identifier so the agent/CLI can fix it.
    await expect(provider.checkCode(code, 'dpo_agent')).rejects.toThrow(/KILL_SWITCH_DOC_ID/);
  }, 60_000);

  it('accepts a valid, import-free function', async () => {
    const mod = await import('@/providers/functions/deno-subhosting.provider.js');
    const provider = mod.DenoSubhostingProvider.getInstance();

    const code = [
      'export default function (_req: Request): Response {',
      '  return new Response("ok");',
      '}',
    ].join('\n');

    await expect(provider.checkCode(code, 'ok_fn')).resolves.toBeUndefined();
  }, 60_000);

  it('is a no-op when Subhosting is not configured (local mode)', async () => {
    delete process.env.DENO_DEPLOY_TOKEN;
    delete process.env.DENO_DEPLOY_ORG_ID;
    const mod = await import('@/providers/functions/deno-subhosting.provider.js');
    const provider = mod.DenoSubhostingProvider.getInstance();

    // Even syntactically broken code resolves when unconfigured — the check only
    // runs in cloud mode; local dev defers to the runtime.
    await expect(
      provider.checkCode('const x = 1; const x = 2;', 'broken')
    ).resolves.toBeUndefined();
  }, 60_000);
});
