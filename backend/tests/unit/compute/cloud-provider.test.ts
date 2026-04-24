import { describe, it, expect, beforeEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';

vi.mock('@/infra/config/app.config.js', () => ({
  config: {
    cloud: { apiHost: 'https://cloud.test', projectId: 'proj-1' },
    app: { jwtSecret: 'secret-1' },
  },
}));

import { CloudComputeProvider } from '@/providers/compute/cloud.provider.js';

describe('CloudComputeProvider', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it('createApp POSTs to /apps with sign header containing JWT { sub: project_id }', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ appId: 'ifc-proj-test' }),
    });

    const provider = CloudComputeProvider.getInstance();
    const result = await provider.createApp({
      name: 'test', network: 'test', org: 'unused-in-cloud-mode',
    });

    const call = (global.fetch as any).mock.calls[0];
    expect(call[0]).toBe('https://cloud.test/projects/v1/proj-1/compute/apps');
    const headers = call[1].headers;
    const decoded = jwt.verify(headers.sign, 'secret-1') as { sub: string };
    expect(decoded.sub).toBe('proj-1');
    expect(result.appId).toBe('ifc-proj-test');
  });

  it('throws COMPUTE_CLOUD_UNAVAILABLE on network error', async () => {
    (global.fetch as any).mockRejectedValue(new Error('ECONNREFUSED'));
    const provider = CloudComputeProvider.getInstance();
    await expect(provider.createApp({ name: 't', network: 't', org: 'o' }))
      .rejects.toThrow(/COMPUTE_CLOUD_UNAVAILABLE/);
  });

  it('throws AppError when cloud returns non-2xx with body', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: false, status: 403,
      text: async () => '{"code":"COMPUTE_QUOTA_EXCEEDED","error":"limit reached"}',
    });
    const provider = CloudComputeProvider.getInstance();
    await expect(provider.createApp({ name: 't', network: 't', org: 'o' }))
      .rejects.toThrow(/limit reached|COMPUTE_QUOTA_EXCEEDED/);
  });

  it('startMachine POSTs to /machines/:id/start with appId in body', async () => {
    (global.fetch as any).mockResolvedValue({ ok: true, text: async () => '' });
    const provider = CloudComputeProvider.getInstance();
    await provider.startMachine('myapp', 'machine-1');
    const call = (global.fetch as any).mock.calls[0];
    expect(call[0]).toBe('https://cloud.test/projects/v1/proj-1/compute/machines/machine-1/start');
    expect(JSON.parse(call[1].body)).toEqual({ appId: 'myapp' });
  });

  it('listMachines GETs /machines with appId in query', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify([{ id: 'm1', state: 'started', region: 'iad' }]),
    });
    const provider = CloudComputeProvider.getInstance();
    const result = await provider.listMachines('myapp');
    const call = (global.fetch as any).mock.calls[0];
    expect(call[0]).toBe('https://cloud.test/projects/v1/proj-1/compute/machines?appId=myapp');
    expect(call[1].method).toBe('GET');
    expect(result).toEqual([{ id: 'm1', state: 'started', region: 'iad' }]);
  });

  it('getLogs forwards limit in query', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify([]),
    });
    const provider = CloudComputeProvider.getInstance();
    await provider.getLogs('myapp', 'machine-1', { limit: 50 });
    const call = (global.fetch as any).mock.calls[0];
    expect(call[0]).toContain('appId=myapp');
    expect(call[0]).toContain('limit=50');
  });

  it('throws COMPUTE_CLOUD_UNAVAILABLE on AbortError (timeout)', async () => {
    const abortError = new DOMException('The operation was aborted', 'AbortError');
    (global.fetch as any).mockRejectedValue(abortError);
    const provider = CloudComputeProvider.getInstance();
    await expect(provider.createApp({ name: 't', network: 't', org: 'o' }))
      .rejects.toMatchObject({ code: 'COMPUTE_CLOUD_UNAVAILABLE' });
  });

  it('surfaces COMPUTE_NOT_CONFIGURED when config is missing (not masked as CLOUD_UNAVAILABLE)', async () => {
    const { AppError } = await import('@/api/middlewares/error.js');
    const { ERROR_CODES } = await import('@/types/error-constants.js');
    const provider = CloudComputeProvider.getInstance();

    // Force signToken to throw COMPUTE_NOT_CONFIGURED, as it would when isConfigured() is false
    vi.spyOn(provider as any, 'signToken').mockImplementation(() => {
      throw new AppError(
        'Cloud compute not configured (need PROJECT_ID and JWT_SECRET)',
        500,
        (ERROR_CODES as any).COMPUTE_NOT_CONFIGURED ?? ERROR_CODES.INTERNAL_ERROR,
      );
    });

    await expect(provider.createApp({ name: 't', network: 't', org: 'o' }))
      .rejects.toThrow(/COMPUTE_NOT_CONFIGURED|not configured/);
  });
});
