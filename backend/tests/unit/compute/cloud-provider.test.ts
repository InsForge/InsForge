import { describe, it, expect, beforeEach, vi, type MockInstance, afterAll } from 'vitest';
import { ERROR_CODES } from '@insforge/shared-schemas';
import jwt from 'jsonwebtoken';

vi.mock('@/infra/config/app.config.js', () => {
  const c = {
    cloud: { apiHost: 'https://cloud.test', projectId: 'proj-1' },
    app: { jwtSecret: 'secret-1', logLevel: 'error' },
    server: { logsDir: '/tmp/insforge-compute-cloud-test-logs' },
  };
  return {
    config: c,
    appConfig: c,
  };
});

import { CloudComputeProvider } from '@/providers/compute/cloud.provider.js';
import { MachineGoneError } from '@/providers/compute/compute.provider.js';

type FetchMock = MockInstance<Parameters<typeof fetch>, ReturnType<typeof fetch>>;

// File-level: both suites below need the marker, and a hook inside the first one has
// already run by the time the second starts.
const savedProfile = process.env.AWS_INSTANCE_PROFILE_NAME;

beforeEach(() => {
  process.env.AWS_INSTANCE_PROFILE_NAME = 'EC2-role';
});

afterAll(() => {
  if (savedProfile === undefined) {
    delete process.env.AWS_INSTANCE_PROFILE_NAME;
  } else {
    process.env.AWS_INSTANCE_PROFILE_NAME = savedProfile;
  }
});

describe('CloudComputeProvider', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    // createApp derives the 6PN network name from APP_KEY.
    process.env.APP_KEY = 'd9byq46t';
    fetchMock = vi.fn() as unknown as FetchMock;
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('createApp POSTs to /apps with sign header containing JWT { sub: project_id }', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ appId: 'ifc-proj-test' }),
    } as Response);

    const provider = CloudComputeProvider.getInstance();
    const result = await provider.createApp({ name: 'test' });

    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe('https://cloud.test/projects/v1/proj-1/compute/apps');
    const headers = (call[1] as RequestInit).headers as Record<string, string>;
    const decoded = jwt.verify(headers.sign, 'secret-1') as { sub: string };
    expect(decoded.sub).toBe('proj-1');
    expect(result.appId).toBe('ifc-proj-test');
  });

  // Regression: live e2e on prod (project 2163e1eb-...) showed Fly 422
  // "Validation failed: Name not a valid network name" because the caller used
  // to pass `${projectId}-network` (~44 chars), which exceeded Fly's
  // network-name validator on stricter orgs. The network name is now derived
  // inside the provider from APP_KEY (~8 chars) rather than passed in — this
  // pins the wire format so it stays byte-identical to what the service sent.
  it('createApp derives the network name from APP_KEY', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ appId: 'ifc-proj-test' }),
    } as Response);

    const provider = CloudComputeProvider.getInstance();
    await provider.createApp({ name: 'test' });

    const call = fetchMock.mock.calls[0];
    const sentBody = JSON.parse((call[1] as RequestInit).body as string);
    expect(sentBody).toEqual({ name: 'test', network: 'n-d9byq46t' });
  });

  it('throws COMPUTE_CLOUD_UNAVAILABLE on network error', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const provider = CloudComputeProvider.getInstance();
    await expect(provider.createApp({ name: 't' })).rejects.toThrow(/COMPUTE_CLOUD_UNAVAILABLE/);
  });

  it('throws AppError when cloud returns non-2xx with body', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      text: async () =>
        JSON.stringify({
          code: ERROR_CODES.COMPUTE_QUOTA_EXCEEDED,
          error: 'limit reached',
        }),
    } as Response);
    const provider = CloudComputeProvider.getInstance();
    await expect(provider.createApp({ name: 't' })).rejects.toThrow(
      new RegExp(`limit reached|${ERROR_CODES.COMPUTE_QUOTA_EXCEEDED}`)
    );
  });

  it('startMachine POSTs to /machines/:id/start with appId in body', async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => '' } as Response);
    const provider = CloudComputeProvider.getInstance();
    await provider.startMachine('myapp', 'machine-1');
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe('https://cloud.test/projects/v1/proj-1/compute/machines/machine-1/start');
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({ appId: 'myapp' });
  });

  it('listMachines GETs /machines with appId in query', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify([{ id: 'm1', state: 'started', region: 'iad' }]),
    } as Response);
    const provider = CloudComputeProvider.getInstance();
    const result = await provider.listMachines('myapp');
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe('https://cloud.test/projects/v1/proj-1/compute/machines?appId=myapp');
    expect((call[1] as RequestInit).method).toBe('GET');
    expect(result).toEqual([{ id: 'm1', state: 'started', region: 'iad' }]);
  });

  it('getEvents forwards limit in query', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify([]),
    } as Response);
    const provider = CloudComputeProvider.getInstance();
    await provider.getEvents('myapp', 'machine-1', { limit: 50 });
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toContain('appId=myapp');
    expect(call[0]).toContain('limit=50');
  });

  it('getLogs GETs /machines/:id/logs forwarding appId, limit, next_token and returns the payload', async () => {
    const payload = { lines: [{ timestamp: 1, message: 'hi' }], nextToken: '42' };
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify(payload),
    } as Response);
    const provider = CloudComputeProvider.getInstance();

    const result = await provider.getLogs('myapp', 'machine-1', { limit: 200, nextToken: 'cur' });

    const call = fetchMock.mock.calls[0];
    expect(call[0]).toContain('/compute/machines/machine-1/logs');
    expect(call[0]).toContain('appId=myapp');
    expect(call[0]).toContain('limit=200');
    expect(call[0]).toContain('next_token=cur');
    expect((call[1] as RequestInit).method).toBe('GET');
    expect(result).toEqual(payload);
  });

  it('getLogs returns empty result when the cloud responds with no body', async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => '' } as Response);
    const provider = CloudComputeProvider.getInstance();

    const result = await provider.getLogs('myapp', 'machine-1');

    expect(result).toEqual({ lines: [], nextToken: null });
  });

  it('throws COMPUTE_CLOUD_UNAVAILABLE on AbortError (timeout)', async () => {
    const abortError = new DOMException('The operation was aborted', 'AbortError');
    fetchMock.mockRejectedValue(abortError);
    const provider = CloudComputeProvider.getInstance();
    await expect(provider.createApp({ name: 't' })).rejects.toMatchObject({
      code: 'COMPUTE_CLOUD_UNAVAILABLE',
    });
  });

  // The catch-all around fetch used to swallow this into COMPUTE_CLOUD_UNAVAILABLE,
  // which reads as "the cloud is down" when the real answer is "this instance has no
  // business calling it".
  it('surfaces COMPUTE_NOT_CONFIGURED off cloud, not masked as CLOUD_UNAVAILABLE', async () => {
    delete process.env.AWS_INSTANCE_PROFILE_NAME;
    const provider = CloudComputeProvider.getInstance();

    await expect(provider.createApp({ name: 't' })).rejects.toMatchObject({
      code: ERROR_CODES.COMPUTE_NOT_CONFIGURED,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// A 404 from a machine-scoped cloud call means the machine no longer exists
// (cloud control plane heals its own row and returns COMPUTE_MACHINE_NOT_FOUND).
// The provider must translate that into MachineGoneError so the service layer
// can heal local DB state; non-404s must pass through untouched.
describe('CloudComputeProvider machine-gone translation', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('translates 404s on machine-scoped calls into MachineGoneError', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      text: async () =>
        JSON.stringify({ code: 'COMPUTE_MACHINE_NOT_FOUND', error: 'Machine m1 not found' }),
    } as Response);

    const provider = CloudComputeProvider.getInstance();
    await expect(provider.getEvents('app-1', 'm1')).rejects.toBeInstanceOf(MachineGoneError);
    await expect(provider.getMachineStatus('app-1', 'm1')).rejects.toBeInstanceOf(MachineGoneError);
    await expect(provider.getLogs('app-1', 'm1')).rejects.toBeInstanceOf(MachineGoneError);
    await expect(provider.startMachine('app-1', 'm1')).rejects.toBeInstanceOf(MachineGoneError);
    await expect(provider.stopMachine('app-1', 'm1')).rejects.toBeInstanceOf(MachineGoneError);
    await expect(provider.destroyMachine('app-1', 'm1')).rejects.toBeInstanceOf(MachineGoneError);
  });

  it('does NOT translate a bare 404 without the COMPUTE_MACHINE_NOT_FOUND body code', async () => {
    // e.g. the cloud-side service row is missing or the path is mis-routed —
    // healing here would orphan a live, billing machine.
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => JSON.stringify({ code: 'COMPUTE_SERVICE_NOT_FOUND', error: 'no row' }),
    } as Response);

    const provider = CloudComputeProvider.getInstance();
    const err = await provider.getEvents('app-1', 'm1').catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(MachineGoneError);
    expect((err as { statusCode: number }).statusCode).toBe(404);
  });

  it('waitForState fails fast when the machine is gone (no 60s poll)', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      text: async () =>
        JSON.stringify({ code: 'COMPUTE_MACHINE_NOT_FOUND', error: 'Machine m1 not found' }),
    } as Response);

    const provider = CloudComputeProvider.getInstance();
    await expect(provider.waitForState('app-1', 'm1', ['stopped'], 60_000)).rejects.toBeInstanceOf(
      MachineGoneError
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT translate non-404 cloud errors', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'internal',
    } as Response);

    const provider = CloudComputeProvider.getInstance();
    const err = await provider.getEvents('app-1', 'm1').catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(MachineGoneError);
    expect((err as { statusCode: number }).statusCode).toBe(500);
  });
});
