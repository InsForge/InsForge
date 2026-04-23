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
const FLY_GRAPHQL_ENDPOINT = 'https://api.fly.io/graphql';

const graphqlOkResponse = () => ({
  ok: true,
  json: () =>
    Promise.resolve({
      data: { allocateIpAddress: { ipAddress: { address: '66.241.125.89', type: 'v4' } } },
    }),
});

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
    it('calls correct URL with correct body and allocates IPs (3 fetches total)', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('') })
        .mockResolvedValueOnce(graphqlOkResponse())
        .mockResolvedValueOnce(graphqlOkResponse());
      vi.stubGlobal('fetch', mockFetch);

      const result = await provider.createApp({
        name: 'my-app',
        network: 'default',
        org: 'test-org',
      });

      expect(mockFetch).toHaveBeenCalledTimes(3);

      // First call: REST app creation
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        `${FLY_API_BASE}/apps`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            app_name: 'my-app',
            org_slug: 'test-org',
            network: 'default',
          }),
        })
      );

      // Second call: shared_v4 GraphQL mutation
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        FLY_GRAPHQL_ENDPOINT,
        expect.objectContaining({ method: 'POST' })
      );
      const body2 = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(body2.variables.input).toEqual({ appId: 'my-app', type: 'shared_v4' });

      // Third call: v6 GraphQL mutation
      expect(mockFetch).toHaveBeenNthCalledWith(
        3,
        FLY_GRAPHQL_ENDPOINT,
        expect.objectContaining({ method: 'POST' })
      );
      const body3 = JSON.parse(mockFetch.mock.calls[2][1].body);
      expect(body3.variables.input).toEqual({ appId: 'my-app', type: 'v6' });

      expect(result).toEqual({ appId: 'my-app' });
    });

    it('throws on Fly API REST error', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        text: () => Promise.resolve('app already exists'),
      });
      vi.stubGlobal('fetch', mockFetch);

      await expect(
        provider.createApp({ name: 'my-app', network: 'default', org: 'test-org' })
      ).rejects.toThrow('Fly API error (422): app already exists');
    });

    it('throws when GraphQL allocateIpAddress returns errors', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('') })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({ errors: [{ message: 'organization limit reached' }] }),
        });
      vi.stubGlobal('fetch', mockFetch);

      await expect(
        provider.createApp({ name: 'my-app', network: 'default', org: 'test-org' })
      ).rejects.toThrow(/Fly GraphQL allocateIpAddress\(shared_v4\) errors/);
    });

    it('throws when GraphQL allocateIpAddress responds non-2xx', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('') })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: () => Promise.resolve('internal server error'),
        });
      vi.stubGlobal('fetch', mockFetch);

      await expect(
        provider.createApp({ name: 'my-app', network: 'default', org: 'test-org' })
      ).rejects.toThrow(/Fly GraphQL allocateIpAddress\(shared_v4\) failed \(500\)/);
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
        expect.objectContaining({ method: 'POST' })
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
        `${FLY_API_BASE}/apps/my-app/machines/machine-123?force=true`,
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  describe('listMachines', () => {
    it('calls GET on machines endpoint and returns array', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify([
              { id: 'machine-1', state: 'started', region: 'iad' },
              { id: 'machine-2', state: 'stopped', region: 'iad' },
            ])
          ),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await provider.listMachines('my-app');

      expect(mockFetch).toHaveBeenCalledWith(
        `${FLY_API_BASE}/apps/my-app/machines`,
        expect.objectContaining({ headers: expect.any(Object) })
      );
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('machine-1');
      expect(result[1].state).toBe('stopped');
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
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });
});
