import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'crypto';
import {
  TrialKeyVerifier,
  isTrialKey,
  isUserAgentKey,
  isAgentKey,
  TRIAL_KEY_PREFIX,
  USER_AGENT_KEY_PREFIX,
} from '../../src/services/auth/trial-key-verifier';

/**
 * Unit tests for the trial-key verifier.
 *
 * Spec: docs/superpowers/specs/2026-04-18-deploy-trial-key-auth.md
 */

describe('prefix predicates', () => {
  it('isTrialKey matches only the trial prefix', () => {
    expect(isTrialKey(`${TRIAL_KEY_PREFIX}abc`)).toBe(true);
    expect(isTrialKey(`${USER_AGENT_KEY_PREFIX}abc`)).toBe(false);
    expect(isTrialKey('ik_1234')).toBe(false);
    expect(isTrialKey('')).toBe(false);
  });

  it('isUserAgentKey matches only the user-agent-key prefix', () => {
    expect(isUserAgentKey(`${USER_AGENT_KEY_PREFIX}abc`)).toBe(true);
    expect(isUserAgentKey(`${TRIAL_KEY_PREFIX}abc`)).toBe(false);
    expect(isUserAgentKey('admin-jwt-abc')).toBe(false);
  });

  it('isAgentKey matches either agent prefix', () => {
    expect(isAgentKey(`${TRIAL_KEY_PREFIX}abc`)).toBe(true);
    expect(isAgentKey(`${USER_AGENT_KEY_PREFIX}abc`)).toBe(true);
    expect(isAgentKey('ik_abc')).toBe(false);
  });
});

describe('TrialKeyVerifier', () => {
  const SECRET = 'shared-service-secret';
  const CLOUD = 'https://cloud.example.test';
  let fetchMock: ReturnType<typeof vi.fn>;
  let verifier: TrialKeyVerifier;
  let nowMs = 1_700_000_000_000;

  const validResponse = () => ({
    valid: true,
    tier: 'trial',
    trial_user_id: '11111111-1111-1111-1111-111111111111',
    project_id: '22222222-2222-2222-2222-222222222222',
    organization_id: '33333333-3333-3333-3333-333333333333',
    quota: {
      api_calls_day: 1000,
      storage_mb: 100,
      compute_deploy_mb: 128,
      compute_hours_day: 2,
      bandwidth_gb_day: 1,
      projects: 1,
    },
    expires_at: '2026-04-25T00:00:00Z',
  });

  const mockFetchOk = (body: unknown): Response =>
    ({
      ok: true,
      status: 200,
      json: async () => body,
    } as unknown as Response);

  const mockFetchFail = (status: number): Response =>
    ({
      ok: false,
      status,
      json: async () => ({ valid: false }),
    } as unknown as Response);

  beforeEach(() => {
    nowMs = 1_700_000_000_000;
    fetchMock = vi.fn();
    verifier = new TrialKeyVerifier({
      cloudApiHost: CLOUD,
      serviceSecret: SECRET,
      cacheTtlMs: 60_000,
      fetchImpl: fetchMock as unknown as typeof fetch,
      now: () => nowMs,
    });
  });

  it('returns null for a non-agent bearer without hitting the network', async () => {
    const result = await verifier.verify('admin-jwt-token');
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null when INTERNAL_SERVICE_SECRET is empty (fails closed)', async () => {
    const v = new TrialKeyVerifier({
      cloudApiHost: CLOUD,
      serviceSecret: '',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const result = await v.verify(`${TRIAL_KEY_PREFIX}abc`);
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('parses a valid trial response and sets tier=trial', async () => {
    fetchMock.mockResolvedValueOnce(mockFetchOk(validResponse()));
    const ctx = await verifier.verify(`${TRIAL_KEY_PREFIX}xyz`);
    expect(ctx).not.toBeNull();
    expect(ctx!.tier).toBe('trial');
    expect(ctx!.projectId).toBe('22222222-2222-2222-2222-222222222222');
    expect(ctx!.trialUserId).toBe('11111111-1111-1111-1111-111111111111');
    expect(ctx!.quota.storage_mb).toBe(100);
    expect(ctx!.expiresAt).toBe('2026-04-25T00:00:00Z');
  });

  it('parses a valid user_agent_key response and sets tier=user_agent_key', async () => {
    fetchMock.mockResolvedValueOnce(
      mockFetchOk({
        valid: true,
        tier: 'user_agent_key',
        user_id: '44444444-4444-4444-4444-444444444444',
        project_id: '22222222-2222-2222-2222-222222222222',
        organization_id: '33333333-3333-3333-3333-333333333333',
        quota: validResponse().quota,
      })
    );
    const ctx = await verifier.verify(`${USER_AGENT_KEY_PREFIX}abc`);
    expect(ctx).not.toBeNull();
    expect(ctx!.tier).toBe('user_agent_key');
    expect(ctx!.userId).toBe('44444444-4444-4444-4444-444444444444');
    expect(ctx!.trialUserId).toBeUndefined();
    expect(ctx!.expiresAt).toBeUndefined();
  });

  it('returns null when cloud responds 401', async () => {
    fetchMock.mockResolvedValueOnce(mockFetchFail(401));
    const result = await verifier.verify(`${TRIAL_KEY_PREFIX}expired`);
    expect(result).toBeNull();
  });

  it('returns null on network error (fails closed)', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await verifier.verify(`${TRIAL_KEY_PREFIX}netdown`);
    expect(result).toBeNull();
  });

  it('returns null when cloud responds with valid=false', async () => {
    fetchMock.mockResolvedValueOnce(
      mockFetchOk({ valid: false, reason: 'revoked' })
    );
    const result = await verifier.verify(`${TRIAL_KEY_PREFIX}revoked`);
    expect(result).toBeNull();
  });

  it('returns null when the tier field is missing/unknown', async () => {
    fetchMock.mockResolvedValueOnce(
      mockFetchOk({ ...validResponse(), tier: 'some_new_tier' })
    );
    const result = await verifier.verify(`${TRIAL_KEY_PREFIX}weird`);
    expect(result).toBeNull();
  });

  it('returns null when the quota blob is missing a numeric field', async () => {
    const bad = validResponse();
    // @ts-expect-error — intentional bad input
    bad.quota.storage_mb = 'one-hundred';
    fetchMock.mockResolvedValueOnce(mockFetchOk(bad));
    const result = await verifier.verify(`${TRIAL_KEY_PREFIX}badquota`);
    expect(result).toBeNull();
  });

  it('returns null for tier=trial without trial_user_id', async () => {
    const bad = validResponse();
    delete (bad as any).trial_user_id;
    fetchMock.mockResolvedValueOnce(mockFetchOk(bad));
    const result = await verifier.verify(`${TRIAL_KEY_PREFIX}noid`);
    expect(result).toBeNull();
  });

  it('caches a valid verdict so a repeat call does not re-hit fetch', async () => {
    fetchMock.mockResolvedValueOnce(mockFetchOk(validResponse()));
    const first = await verifier.verify(`${TRIAL_KEY_PREFIX}xyz`);
    const second = await verifier.verify(`${TRIAL_KEY_PREFIX}xyz`);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('expires cache after TTL elapses', async () => {
    fetchMock
      .mockResolvedValueOnce(mockFetchOk(validResponse()))
      .mockResolvedValueOnce(mockFetchOk(validResponse()));
    await verifier.verify(`${TRIAL_KEY_PREFIX}xyz`);
    nowMs += 61_000; // past TTL
    await verifier.verify(`${TRIAL_KEY_PREFIX}xyz`);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('invalidate() drops the cached verdict', async () => {
    fetchMock
      .mockResolvedValueOnce(mockFetchOk(validResponse()))
      .mockResolvedValueOnce(mockFetchOk(validResponse()));
    const token = `${TRIAL_KEY_PREFIX}xyz`;
    await verifier.verify(token);
    verifier.invalidate(token);
    await verifier.verify(token);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('signs the request with HMAC-SHA256 over ts.nonce.body', async () => {
    fetchMock.mockResolvedValueOnce(mockFetchOk(validResponse()));
    await verifier.verify(`${TRIAL_KEY_PREFIX}sig`);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${CLOUD}/internal/v1/verify-agent-key`);
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    const ts = headers['X-Service-Timestamp'];
    const nonce = headers['X-Service-Nonce'];
    const sigHeader = headers['X-Service-Signature'];
    expect(ts).toMatch(/^\d+$/);
    expect(nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(sigHeader.startsWith('sha256=')).toBe(true);
    const sig = sigHeader.replace('sha256=', '');
    const body = (init as RequestInit).body as string;
    const expected = crypto
      .createHmac('sha256', SECRET)
      .update(`${ts}.${nonce}.${body}`)
      .digest('hex');
    expect(sig).toBe(expected);
  });

  it('trims a trailing slash from cloudApiHost', async () => {
    const v = new TrialKeyVerifier({
      cloudApiHost: `${CLOUD}/`,
      serviceSecret: SECRET,
      fetchImpl: fetchMock as unknown as typeof fetch,
      now: () => nowMs,
    });
    fetchMock.mockResolvedValueOnce(mockFetchOk(validResponse()));
    await v.verify(`${TRIAL_KEY_PREFIX}abc`);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(`${CLOUD}/internal/v1/verify-agent-key`);
  });
});
