import { ERROR_CODES } from '@insforge/shared-schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// End-to-end through the REAL DenoSubhostingProvider running the REAL
// `deno check` (the provider is intentionally NOT mocked here). Proves the
// wired createFunction path actually rejects the #1594 bug — a duplicate
// top-level declaration — before any DB write. Only DB/secret/logger are
// mocked, so this exercises the full service -> provider -> deno check chain.

const mockClient = { query: vi.fn(), release: vi.fn() };
const mockPool = { query: vi.fn(), connect: vi.fn().mockResolvedValue(mockClient) };

vi.mock('../../src/infra/database/database.manager.js', () => ({
  DatabaseManager: {
    getInstance: () => ({ getPool: () => mockPool }),
  },
}));

vi.mock('../../src/services/secrets/secret.service.js', () => ({
  SecretService: { getInstance: () => ({}) },
}));

vi.mock('../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const DUPLICATE_DECL = [
  'const KILL_SWITCH_DOC_ID = "global";',
  'export default function (_req: Request): Response {',
  '  return new Response(KILL_SWITCH_DOC_ID);',
  '}',
  'var KILL_SWITCH_DOC_ID = "global";',
].join('\n');

describe('Pre-deploy check — end to end through real deno check (#1594)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.DENO_DEPLOY_TOKEN = 't';
    process.env.DENO_DEPLOY_ORG_ID = 'o';
  });

  afterEach(() => {
    delete process.env.DENO_DEPLOY_TOKEN;
    delete process.env.DENO_DEPLOY_ORG_ID;
  });

  it('rejects the real duplicate-declaration function with a 400 before any DB write', async () => {
    const { FunctionService } = await import(
      '../../src/services/functions/function.service.js'
    );
    const service = FunctionService.getInstance();

    await expect(
      service.createFunction({
        slug: 'dpo_agent',
        name: 'DPO Agent',
        code: DUPLICATE_DECL,
        status: 'active',
      })
    ).rejects.toMatchObject({ statusCode: 400, code: ERROR_CODES.INVALID_INPUT });

    // The real `deno check` names the offending identifier, and the bad
    // function must never reach the database.
    await expect(
      service.createFunction({
        slug: 'dpo_agent',
        name: 'DPO Agent',
        code: DUPLICATE_DECL,
        status: 'active',
      })
    ).rejects.toThrow(/KILL_SWITCH_DOC_ID/);

    expect(mockPool.connect).not.toHaveBeenCalled();
  }, 60_000);

  it('does NOT block the same code when it is uploaded inactive (no deploy => no check)', async () => {
    const { FunctionService } = await import(
      '../../src/services/functions/function.service.js'
    );
    const service = FunctionService.getInstance();

    // Inactive functions are not deployed, so the static check is skipped and
    // the DB write proceeds (mocked). Guards the create-time gating.
    mockClient.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: '1', slug: 'dpo_agent' }] });

    await expect(
      service.createFunction({
        slug: 'dpo_agent',
        name: 'DPO Agent',
        code: DUPLICATE_DECL,
        status: 'inactive',
      })
    ).resolves.toBeDefined();

    expect(mockPool.connect).toHaveBeenCalled();
  }, 60_000);
});
