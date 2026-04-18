import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Unit tests for verifyAdminOrTrialAgent middleware.
 *
 * We mock TokenManager + SecretService so the legacy verifyAdmin branch
 * is exercised as a black box — the goal is to prove:
 *   1. agent-key bearers go through the trial verifier branch
 *   2. non-agent bearers fall through to verifyAdmin unchanged
 *
 * Spec: docs/superpowers/specs/2026-04-18-deploy-trial-key-auth.md
 */

// vi.mock is hoisted to the top of the file BEFORE the const declarations,
// so we need vi.hoisted() to share mock fns between the factory and tests.
const mocks = vi.hoisted(() => ({
  verifyToken: vi.fn(),
  verifyApiKey: vi.fn(),
}));

vi.mock('../../src/infra/security/token.manager', () => ({
  TokenManager: {
    getInstance: () => ({
      verifyToken: mocks.verifyToken,
      verifyCloudToken: vi.fn(),
    }),
  },
}));

vi.mock('../../src/services/secrets/secret.service', () => ({
  SecretService: {
    getInstance: () => ({
      verifyApiKey: mocks.verifyApiKey,
    }),
  },
}));

import { verifyAdminOrTrialAgent, AuthRequest } from '../../src/api/middlewares/auth';
import {
  TrialKeyVerifier,
  TRIAL_KEY_PREFIX,
  USER_AGENT_KEY_PREFIX,
  TrialContext,
} from '../../src/services/auth/trial-key-verifier';

const validTrialContext: TrialContext = {
  tier: 'trial',
  trialUserId: '11111111-1111-1111-1111-111111111111',
  projectId: '22222222-2222-2222-2222-222222222222',
  organizationId: '33333333-3333-3333-3333-333333333333',
  quota: {
    api_calls_day: 1000,
    storage_mb: 100,
    compute_deploy_mb: 128,
    compute_hours_day: 2,
    bandwidth_gb_day: 1,
    projects: 1,
  },
  expiresAt: '2030-01-01T00:00:00Z',
};

function makeReq(authHeader?: string): AuthRequest {
  const headers: Record<string, string> = {};
  if (authHeader) headers.authorization = authHeader;
  return { headers } as unknown as AuthRequest;
}

const makeRes = () => {
  const res: any = {};
  res.status = (c: number) => {
    res._status = c;
    return res;
  };
  res.json = (b: any) => {
    res._body = b;
    return res;
  };
  return res;
};

describe('verifyAdminOrTrialAgent', () => {
  beforeEach(() => {
    mocks.verifyToken.mockReset();
    mocks.verifyApiKey.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sets req.trial and calls next() when a trial_key verifies', async () => {
    const fakeVerifier = {
      verify: vi.fn().mockResolvedValue(validTrialContext),
    } as unknown as TrialKeyVerifier;

    const mw = verifyAdminOrTrialAgent(fakeVerifier);
    const req = makeReq(`Bearer ${TRIAL_KEY_PREFIX}valid`);
    const res = makeRes();
    const errors: unknown[] = [];
    await mw(req, res, (err?: unknown) => {
      if (err) errors.push(err);
    });

    expect(errors).toEqual([]);
    expect(req.trial).toEqual(validTrialContext);
    expect(req.authenticated).toBe(true);
    expect(fakeVerifier.verify).toHaveBeenCalledTimes(1);
  });

  it('forwards an AppError when a trial_key fails verification', async () => {
    const fakeVerifier = {
      verify: vi.fn().mockResolvedValue(null),
    } as unknown as TrialKeyVerifier;

    const mw = verifyAdminOrTrialAgent(fakeVerifier);
    const req = makeReq(`Bearer ${TRIAL_KEY_PREFIX}revoked`);
    const res = makeRes();
    const errors: unknown[] = [];
    await mw(req, res, (err?: unknown) => {
      if (err) errors.push(err);
    });

    expect(errors).toHaveLength(1);
    const err = errors[0] as { statusCode?: number; message: string };
    expect(err.statusCode).toBe(401);
    expect(err.message).toContain('agent key');
    expect(req.trial).toBeUndefined();
  });

  it('accepts a user-agent-key the same way as a trial_key', async () => {
    const userCtx: TrialContext = {
      tier: 'user_agent_key',
      userId: '44444444-4444-4444-4444-444444444444',
      projectId: validTrialContext.projectId,
      organizationId: validTrialContext.organizationId,
      quota: validTrialContext.quota,
    };
    const fakeVerifier = {
      verify: vi.fn().mockResolvedValue(userCtx),
    } as unknown as TrialKeyVerifier;

    const mw = verifyAdminOrTrialAgent(fakeVerifier);
    const req = makeReq(`Bearer ${USER_AGENT_KEY_PREFIX}valid`);
    const res = makeRes();
    let nextCalled = false;
    await mw(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(req.trial?.tier).toBe('user_agent_key');
    expect(req.trial?.userId).toBe('44444444-4444-4444-4444-444444444444');
  });

  it('falls through to verifyAdmin for an admin JWT (does not invoke verifier)', async () => {
    mocks.verifyToken.mockReturnValueOnce({
      sub: 'user-1',
      email: 'admin@example.com',
      role: 'project_admin',
    });
    const fakeVerifier = {
      verify: vi.fn(),
    } as unknown as TrialKeyVerifier;

    const mw = verifyAdminOrTrialAgent(fakeVerifier);
    const req = makeReq('Bearer admin-jwt-abc123');
    const res = makeRes();
    let nextCalled = false;
    await mw(req, res, () => {
      nextCalled = true;
    });

    expect(fakeVerifier.verify).not.toHaveBeenCalled();
    expect(nextCalled).toBe(true);
    expect(req.user?.email).toBe('admin@example.com');
    expect(req.trial).toBeUndefined();
  });

  it('falls through to verifyApiKey for an ik_ bearer (does not invoke verifier)', async () => {
    mocks.verifyApiKey.mockResolvedValueOnce(true);
    const fakeVerifier = {
      verify: vi.fn(),
    } as unknown as TrialKeyVerifier;

    const mw = verifyAdminOrTrialAgent(fakeVerifier);
    const req = makeReq('Bearer ik_project_key_abc');
    const res = makeRes();
    let nextCalled = false;
    await mw(req, res, () => {
      nextCalled = true;
    });

    expect(fakeVerifier.verify).not.toHaveBeenCalled();
    expect(nextCalled).toBe(true);
    expect(req.authenticated).toBe(true);
    expect(req.apiKey).toBe('ik_project_key_abc');
  });

  it('rejects requests with no bearer (matches verifyAdmin behavior)', async () => {
    const fakeVerifier = {
      verify: vi.fn(),
    } as unknown as TrialKeyVerifier;

    const mw = verifyAdminOrTrialAgent(fakeVerifier);
    const req = makeReq();
    const res = makeRes();
    const errors: unknown[] = [];
    await mw(req, res, (err?: unknown) => {
      if (err) errors.push(err);
    });

    expect(errors).toHaveLength(1);
    const err = errors[0] as { statusCode: number };
    expect(err.statusCode).toBe(401);
    expect(fakeVerifier.verify).not.toHaveBeenCalled();
  });

  it('propagates a thrown Error from the verifier as a 401 AppError', async () => {
    const fakeVerifier = {
      verify: vi.fn().mockRejectedValue(new Error('boom')),
    } as unknown as TrialKeyVerifier;

    const mw = verifyAdminOrTrialAgent(fakeVerifier);
    const req = makeReq(`Bearer ${TRIAL_KEY_PREFIX}explodes`);
    const res = makeRes();
    const errors: unknown[] = [];
    await mw(req, res, (err?: unknown) => {
      if (err) errors.push(err);
    });

    expect(errors).toHaveLength(1);
    const err = errors[0] as { statusCode?: number };
    expect(err.statusCode).toBe(401);
  });
});
