import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/infra/config/app.config.js', () => ({
  config: {
    fly: {
      enabled: true,
      apiToken: 'test-token',
      org: 'test-org',
      domain: 'compute.test.dev',
    },
  },
}));

vi.mock('@/utils/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { FlyProvider } from '@/providers/compute/fly.provider.js';

const FLY_API_BASE = 'https://api.machines.dev/v1';

describe('FlyProvider', () => {
  let provider: FlyProvider;

  beforeEach(() => {
    provider = FlyProvider.getInstance();
    vi.restoreAllMocks();
  });

  it('isConfigured() returns true when config is set', () => {
    expect(provider.isConfigured()).toBe(true);
  });

  describe('createApp', () => {
    it('calls correct URL with correct body', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(''),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await provider.createApp({
        name: 'my-app',
        network: 'default',
        org: 'test-org',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `${FLY_API_BASE}/apps`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            app_name: 'my-app',
            org_slug: 'test-org',
            network: 'default',
          }),
        }),
      );
      expect(result).toEqual({ appId: 'my-app' });
    });

    it('throws on Fly API error', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        text: () => Promise.resolve('app already exists'),
      });
      vi.stubGlobal('fetch', mockFetch);

      await expect(
        provider.createApp({ name: 'my-app', network: 'default', org: 'test-org' }),
      ).rejects.toThrow('Fly API error (422): app already exists');
    });
  });

  describe('launchMachine', () => {
    it('calls correct URL, returns machineId, sets correct body', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ id: 'machine-abc123' })),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await provider.launchMachine({
        appId: 'my-app',
        image: 'registry.fly.io/my-app:latest',
        port: 8080,
        cpu: 'shared-1x',
        memory: 256,
        envVars: { NODE_ENV: 'production' },
        region: 'iad',
      });

      expect(result).toEqual({ machineId: 'machine-abc123' });

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toBe(`${FLY_API_BASE}/apps/my-app/machines`);
      expect(callArgs[1].method).toBe('POST');

      const body = JSON.parse(callArgs[1].body);
      expect(body.config.image).toBe('registry.fly.io/my-app:latest');
      expect(body.config.env).toEqual({ NODE_ENV: 'production' });
      expect(body.config.guest).toEqual({ cpu_kind: 'shared', cpus: 1, memory_mb: 256 });
      expect(body.config.services[0].internal_port).toBe(8080);
      expect(body.config.services[0].protocol).toBe('tcp');
      expect(body.config.services[0].ports).toEqual([
        { port: 443, handlers: ['tls', 'http'] },
        { port: 80, handlers: ['http'] },
      ]);
      expect(body.region).toBe('iad');
    });
  });

  describe('stopMachine', () => {
    it('calls POST to stop endpoint', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(''),
      });
      vi.stubGlobal('fetch', mockFetch);

      await provider.stopMachine('my-app', 'machine-123');

      expect(mockFetch).toHaveBeenCalledWith(
        `${FLY_API_BASE}/apps/my-app/machines/machine-123/stop`,
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('destroyMachine', () => {
    it('calls DELETE to machine endpoint', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(''),
      });
      vi.stubGlobal('fetch', mockFetch);

      await provider.destroyMachine('my-app', 'machine-123');

      expect(mockFetch).toHaveBeenCalledWith(
        `${FLY_API_BASE}/apps/my-app/machines/machine-123`,
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  describe('destroyApp', () => {
    it('calls DELETE to app endpoint', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(''),
      });
      vi.stubGlobal('fetch', mockFetch);

      await provider.destroyApp('my-app');

      expect(mockFetch).toHaveBeenCalledWith(
        `${FLY_API_BASE}/apps/my-app`,
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });
});
