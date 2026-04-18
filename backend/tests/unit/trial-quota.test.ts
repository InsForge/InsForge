import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  evaluateTrialDeployQuota,
  buildClaimUrl,
  checkTrialDeployQuota,
} from '../../src/api/middlewares/trial-quota';
import type { AuthRequest } from '../../src/api/middlewares/auth';
import type { TrialContext } from '../../src/services/auth/trial-key-verifier';

/**
 * Unit tests for trial-quota enforcement.
 *
 * Spec: docs/superpowers/specs/2026-04-18-deploy-trial-key-auth.md
 */

const MB = 1024 * 1024;

function makeTrialContext(overrides: Partial<TrialContext> = {}): TrialContext {
  return {
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
    ...overrides,
  };
}

function makeReq(trial?: TrialContext, contentLength?: string): AuthRequest {
  const headers: Record<string, string> = {};
  if (contentLength !== undefined) headers['content-length'] = contentLength;
  return { trial, headers } as unknown as AuthRequest;
}

describe('evaluateTrialDeployQuota', () => {
  it('returns allowed=true when req.trial is absent (admin path)', () => {
    const result = evaluateTrialDeployQuota(makeReq(undefined), null);
    expect(result.allowed).toBe(true);
  });

  it('allows a trial caller well under the per-file cap', () => {
    const result = evaluateTrialDeployQuota(makeReq(makeTrialContext()), 1 * MB);
    expect(result.allowed).toBe(true);
  });

  it('rejects when trial has expired', () => {
    const ctx = makeTrialContext({ expiresAt: '2020-01-01T00:00:00Z' });
    const result = evaluateTrialDeployQuota(makeReq(ctx), 1 * MB);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('trial_expired');
  });

  it('does NOT enforce expiry for tier=user_agent_key', () => {
    const ctx = makeTrialContext({
      tier: 'user_agent_key',
      trialUserId: undefined,
      userId: '44444444-4444-4444-4444-444444444444',
      expiresAt: undefined,
    });
    const result = evaluateTrialDeployQuota(makeReq(ctx), 1 * MB);
    expect(result.allowed).toBe(true);
  });

  it('rejects when compute_deploy_mb is zero', () => {
    const ctx = makeTrialContext({
      quota: { ...makeTrialContext().quota, compute_deploy_mb: 0 },
    });
    const result = evaluateTrialDeployQuota(makeReq(ctx), null);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('compute_deploy_zero');
  });

  it('rejects when Content-Length exceeds the storage cap', () => {
    const ctx = makeTrialContext(); // storage=100MB, compute_deploy=128MB → min=100MB
    const result = evaluateTrialDeployQuota(makeReq(ctx), 101 * MB);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('storage_exceeded');
    expect(result.attemptedBytes).toBe(101 * MB);
    expect(result.maxBytes).toBe(100 * MB);
  });

  it('rejects when Content-Length exceeds the compute_deploy cap (tighter than storage)', () => {
    const ctx = makeTrialContext({
      quota: { ...makeTrialContext().quota, storage_mb: 500, compute_deploy_mb: 50 },
    });
    const result = evaluateTrialDeployQuota(makeReq(ctx), 51 * MB);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('storage_exceeded');
    expect(result.maxBytes).toBe(50 * MB);
  });

  it('allows zero Content-Length (pre-upload creation calls)', () => {
    const ctx = makeTrialContext();
    const result = evaluateTrialDeployQuota(makeReq(ctx), 0);
    expect(result.allowed).toBe(true);
  });
});

describe('buildClaimUrl', () => {
  const oldCloudHost = process.env.CLOUD_API_HOST;

  beforeEach(() => {
    process.env.CLOUD_API_HOST = 'https://cloud.example.test';
  });

  afterEach(() => {
    if (oldCloudHost === undefined) delete process.env.CLOUD_API_HOST;
    else process.env.CLOUD_API_HOST = oldCloudHost;
  });

  it('returns null for admin (no req.trial)', () => {
    expect(buildClaimUrl(makeReq(undefined))).toBeNull();
  });

  it('returns null for user_agent_key tier (already claimed)', () => {
    const ctx = makeTrialContext({
      tier: 'user_agent_key',
      trialUserId: undefined,
      userId: '44444444-4444-4444-4444-444444444444',
    });
    expect(buildClaimUrl(makeReq(ctx))).toBeNull();
  });

  it('builds {CLOUD_API_HOST}/claim/{trial_user_id} for trial tier', () => {
    const ctx = makeTrialContext();
    expect(buildClaimUrl(makeReq(ctx))).toBe(
      'https://cloud.example.test/claim/11111111-1111-1111-1111-111111111111'
    );
  });

  it('trims a trailing slash from CLOUD_API_HOST', () => {
    process.env.CLOUD_API_HOST = 'https://cloud.example.test/';
    const ctx = makeTrialContext();
    expect(buildClaimUrl(makeReq(ctx))).toBe(
      'https://cloud.example.test/claim/11111111-1111-1111-1111-111111111111'
    );
  });
});

describe('checkTrialDeployQuota (express middleware)', () => {
  const makeRes = () => {
    const res: any = {};
    res.status = (code: number) => {
      res._status = code;
      return res;
    };
    res.json = (body: any) => {
      res._body = body;
      return res;
    };
    return res;
  };

  it('calls next() on allowed requests', () => {
    const req = makeReq(makeTrialContext(), '1024');
    const res = makeRes();
    let called = false;
    checkTrialDeployQuota(req, res, () => {
      called = true;
    });
    expect(called).toBe(true);
    expect(res._status).toBeUndefined();
  });

  it('responds 402 on storage_exceeded with claim_required and claim_url', () => {
    process.env.CLOUD_API_HOST = 'https://cloud.example.test';
    const req = makeReq(makeTrialContext(), String(101 * MB));
    const res = makeRes();
    let nextCalled = false;
    checkTrialDeployQuota(req, res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(false);
    expect(res._status).toBe(402);
    expect(res._body.error).toBe('claim_required');
    expect(res._body.reason).toBe('storage_exceeded');
    expect(res._body.claim_url).toContain('/claim/');
    expect(res._body.attempted_bytes).toBe(101 * MB);
    expect(res._body.max_bytes).toBe(100 * MB);
  });

  it('responds 402 on trial_expired without storage fields', () => {
    const ctx = makeTrialContext({ expiresAt: '2020-01-01T00:00:00Z' });
    const req = makeReq(ctx, '1024');
    const res = makeRes();
    checkTrialDeployQuota(req, res, () => {});
    expect(res._status).toBe(402);
    expect(res._body.reason).toBe('trial_expired');
    expect(res._body.attempted_bytes).toBeUndefined();
  });

  it('no-ops when req.trial is absent (admin path)', () => {
    const req = makeReq(undefined, '99999999999');
    const res = makeRes();
    let called = false;
    checkTrialDeployQuota(req, res, () => {
      called = true;
    });
    expect(called).toBe(true);
    expect(res._status).toBeUndefined();
  });
});
