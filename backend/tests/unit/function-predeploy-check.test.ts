import { ERROR_CODES } from '@insforge/shared-schemas';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/utils/errors.js';

// Verifies the pre-deploy static check is actually WIRED into the write path.
// Regression guard for issue #1594: a function with a duplicate declaration
// builds but fails Deno isolate warm-up, and because all active functions ship
// as one Deno revision, it wedged every deploy for the whole project. The fix
// is to run `checkCode` (deno check) at create/update time so bad code is
// rejected up front — before it can enter the active set.

const mockClient = { query: vi.fn(), release: vi.fn() };
const mockPool = { query: vi.fn(), connect: vi.fn().mockResolvedValue(mockClient) };
const checkCode = vi.fn();

vi.mock('../../src/infra/database/database.manager.js', () => ({
  DatabaseManager: {
    getInstance: () => ({ getPool: () => mockPool }),
  },
}));

vi.mock('../../src/providers/functions/deno-subhosting.provider.js', () => ({
  DenoSubhostingProvider: {
    getInstance: () => ({
      isConfigured: vi.fn().mockReturnValue(false),
      checkCode,
    }),
  },
}));

vi.mock('../../src/services/secrets/secret.service.js', () => ({
  SecretService: { getInstance: () => ({}) },
}));

vi.mock('../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { FunctionService } from '../../src/services/functions/function.service.js';

describe('Pre-deploy static check wiring (issue #1594)', () => {
  let service: FunctionService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = FunctionService.getInstance();
  });

  it('createFunction runs checkCode and fails fast (no DB write) when it rejects', async () => {
    checkCode.mockRejectedValueOnce(
      new AppError(
        "Function code failed type check:\nTS2451 Cannot redeclare block-scoped variable 'KILL_SWITCH_DOC_ID'.",
        400,
        ERROR_CODES.INVALID_INPUT
      )
    );

    const badCode = 'const KILL_SWITCH_DOC_ID = "global";\nvar KILL_SWITCH_DOC_ID = "global";';

    await expect(
      service.createFunction({
        slug: 'dpo_agent',
        name: 'DPO Agent',
        code: badCode,
        status: 'active',
      })
    ).rejects.toMatchObject({ statusCode: 400, code: ERROR_CODES.INVALID_INPUT });

    expect(checkCode).toHaveBeenCalledWith(badCode, 'dpo_agent');
    // The check must run BEFORE any DB write so a bad function never persists.
    expect(mockPool.connect).not.toHaveBeenCalled();
  });

  it('createFunction proceeds to persist when checkCode passes', async () => {
    checkCode.mockResolvedValueOnce(undefined);
    mockClient.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: '1', slug: 'ok' }] });

    await expect(
      service.createFunction({
        slug: 'ok',
        name: 'OK',
        code: 'export default () => new Response("ok")',
        status: 'active',
      })
    ).resolves.toBeDefined();

    expect(checkCode).toHaveBeenCalledTimes(1);
  });

  it('updateFunction checks NEW code when updating an active function', async () => {
    // Existence/status pre-fetch: active function.
    mockPool.query.mockResolvedValueOnce({ rows: [{ code: 'old', status: 'active' }] });
    checkCode.mockRejectedValueOnce(new AppError('rejected', 400, ERROR_CODES.INVALID_INPUT));

    await expect(
      service.updateFunction('dpo_agent', { code: 'const X = 1;\nvar X = 2;' })
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(checkCode).toHaveBeenCalledWith('const X = 1;\nvar X = 2;', 'dpo_agent');
    expect(mockPool.connect).not.toHaveBeenCalled(); // failed before any write
  });

  it('updateFunction checks STORED code on status-only activation (issue #1594 gap)', async () => {
    // Activating a previously-inactive function with no new code: the stored
    // (possibly bad) code must still be checked before it joins the Deno revision.
    mockPool.query.mockResolvedValueOnce({
      rows: [{ code: 'const X = 1;\nvar X = 2;', status: 'inactive' }],
    });
    checkCode.mockRejectedValueOnce(new AppError('rejected', 400, ERROR_CODES.INVALID_INPUT));

    await expect(service.updateFunction('dpo_agent', { status: 'active' })).rejects.toMatchObject({
      statusCode: 400,
    });

    expect(checkCode).toHaveBeenCalledWith('const X = 1;\nvar X = 2;', 'dpo_agent');
    expect(mockPool.connect).not.toHaveBeenCalled();
  });

  it('updateFunction does NOT check a code edit on an inactive draft', async () => {
    // Devs iterating on a broken draft (kept inactive) are not blocked.
    mockPool.query.mockResolvedValueOnce({ rows: [{ code: 'old', status: 'inactive' }] });
    mockClient.query.mockResolvedValue({ rows: [{ id: '1', slug: 'draft', status: 'inactive' }] });

    await expect(
      service.updateFunction('draft', { code: 'const X = 1;\nvar X = 2;' })
    ).resolves.toBeDefined();

    expect(checkCode).not.toHaveBeenCalled();
  });

  it('updateFunction on a missing slug returns null without checking', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // not found

    await expect(service.updateFunction('ghost', { code: 'whatever' })).resolves.toBeNull();

    expect(checkCode).not.toHaveBeenCalled();
    expect(mockPool.connect).not.toHaveBeenCalled();
  });
});
