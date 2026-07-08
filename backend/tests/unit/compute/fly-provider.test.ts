import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/infra/config/app.config.js', () => {
  const c = {
    fly: {
      enabled: true,
      apiToken: 'test-token',
      org: 'test-org',
      domain: 'compute.test.dev',
    },
  };
  return {
    config: c,
    appConfig: c,
  };
});

vi.mock('@/utils/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { FlyProvider } from '@/providers/compute/fly.provider.js';
import { MachineGoneError } from '@/providers/compute/compute.provider.js';

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
          json: () => Promise.resolve({ errors: [{ message: 'organization limit reached' }] }),
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
      // Scale-to-zero defaults — without these Fly keeps the machine warm 24/7.
      // Note: the Machines API uses the short field names (`autostop`/`autostart`),
      // NOT fly.toml's `auto_stop_machines`/`auto_start_machines`. The API
      // silently ignores unknown fields, so the wrong names look healthy at
      // request time but leave the machine always-on. Schema reference:
      // https://docs.machines.dev/spec/openapi3.json (fly.MachineService).
      expect(body.config.services[0].autostop).toBe('stop');
      expect(body.config.services[0].autostart).toBe(true);
      expect(body.config.services[0].min_machines_running).toBe(0);
      expect(body.region).toBe('iad');
    });

    // scaleToZero: false flips the autostop block to always-on. min_machines_running
    // must be 1 (not just autostop 'off') so Fly restarts the machine if it
    // exits — always-on services should survive crashes, not just skip the
    // idle stop.
    it('scaleToZero: false sends autostop off with one machine kept running', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ id: 'machine-always-on' })),
      });
      vi.stubGlobal('fetch', mockFetch);

      await provider.launchMachine({
        appId: 'my-app',
        image: 'registry.fly.io/my-app:latest',
        port: 8080,
        cpu: 'shared-1x',
        memory: 256,
        envVars: {},
        region: 'iad',
        scaleToZero: false,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.config.services[0].autostop).toBe('off');
      expect(body.config.services[0].autostart).toBe(true);
      expect(body.config.services[0].min_machines_running).toBe(1);
    });

    // scaleToZero: true must be byte-identical to omitting the field — only
    // an explicit `false` may change the wire format.
    it('scaleToZero: true keeps the scale-to-zero defaults', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ id: 'machine-stz' })),
      });
      vi.stubGlobal('fetch', mockFetch);

      await provider.launchMachine({
        appId: 'my-app',
        image: 'registry.fly.io/my-app:latest',
        port: 8080,
        cpu: 'shared-1x',
        memory: 256,
        envVars: {},
        region: 'iad',
        scaleToZero: true,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.config.services[0].autostop).toBe('stop');
      expect(body.config.services[0].autostart).toBe(true);
      expect(body.config.services[0].min_machines_running).toBe(0);
    });

    // INS-271: protocol: 'tcp' switches the edge-handler shape from the
    // HTTP-terminating 443/80 pair to a single direct-passthrough port that
    // matches internal_port with empty L7 handlers. Without this, raw TCP
    // services (Redis, the Postgres wire protocol, etc.) wedge behind the
    // Fly anycast HTTP proxy.
    it('protocol: tcp sets services[].ports to a single passthrough entry with empty handlers', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ id: 'machine-tcp' })),
      });
      vi.stubGlobal('fetch', mockFetch);

      await provider.launchMachine({
        appId: 'my-redis',
        image: 'redis:7',
        port: 6379,
        cpu: 'shared-1x',
        memory: 256,
        envVars: {},
        region: 'iad',
        protocol: 'tcp',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.config.services[0].internal_port).toBe(6379);
      // Single port = internal port, no TLS/HTTP handlers — bytes pass through.
      expect(body.config.services[0].ports).toEqual([{ port: 6379, handlers: [] }]);
      // Fly's services[].protocol stays 'tcp' (L4 protocol) regardless of
      // edge mode — that's a Fly API constant, not our protocol field.
      expect(body.config.services[0].protocol).toBe('tcp');
    });

    // Back-compat — omitting `protocol` is the same as passing 'http'. We pin
    // both call shapes so a future refactor that flips the default doesn't
    // silently change the wire format for existing HTTP deploys.
    it('omitting protocol defaults to http edge handlers (443 TLS + 80 plain)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ id: 'machine-http' })),
      });
      vi.stubGlobal('fetch', mockFetch);

      await provider.launchMachine({
        appId: 'my-api',
        image: 'node:20',
        port: 8080,
        cpu: 'shared-1x',
        memory: 256,
        envVars: {},
        region: 'iad',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.config.services[0].ports).toEqual([
        { port: 443, handlers: ['tls', 'http'] },
        { port: 80, handlers: ['http'] },
      ]);
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

  describe('getLogs', () => {
    const okText = (raw: string) => ({ ok: true, text: () => Promise.resolve(raw) });

    it('hits the api.fly.io logs host with the FlyV1 scheme, scoped to the machine', async () => {
      const mockFetch = vi.fn().mockResolvedValue(okText('{"data":[],"meta":{}}'));
      vi.stubGlobal('fetch', mockFetch);

      await provider.getLogs('my-app', 'machine-123');

      const [calledUrl, init] = mockFetch.mock.calls[0];
      expect(calledUrl).toContain('https://api.fly.io/api/v1/apps/my-app/logs');
      // Scopes to this service's machine via the `instance` query param.
      expect(calledUrl).toContain('instance=machine-123');
      // Logs use Fly's macaroon scheme, NOT Bearer (which 401s on this host).
      expect((init.headers as Record<string, string>).Authorization).toBe('FlyV1 test-token');
    });

    it('normalizes RFC3339 timestamps to epoch ms', async () => {
      const raw =
        '{"data":[{"attributes":{"timestamp":"2026-06-04T21:25:05.000Z",' +
        '"message":"hello from container","instance":"machine-123","region":"iad"}}],"meta":{}}';
      const mockFetch = vi.fn().mockResolvedValue(okText(raw));
      vi.stubGlobal('fetch', mockFetch);

      const result = await provider.getLogs('my-app', 'machine-123');

      expect(result.lines).toEqual([
        {
          timestamp: Date.parse('2026-06-04T21:25:05.000Z'),
          message: 'hello from container',
          instance: 'machine-123',
          region: 'iad',
        },
      ]);
    });

    it('returns next_token at full precision (it exceeds Number.MAX_SAFE_INTEGER)', async () => {
      // A bare JSON number here would round to ...890600 under JSON.parse;
      // the provider must preserve every digit by reading the raw text.
      const raw = '{"data":[],"meta":{"next_token":1780608313161890637}}';
      const mockFetch = vi.fn().mockResolvedValue(okText(raw));
      vi.stubGlobal('fetch', mockFetch);

      const result = await provider.getLogs('my-app', 'machine-123');

      expect(result.nextToken).toBe('1780608313161890637');
    });

    it('forwards the requested limit as a Fly query param', async () => {
      const mockFetch = vi.fn().mockResolvedValue(okText('{"data":[],"meta":{}}'));
      vi.stubGlobal('fetch', mockFetch);

      await provider.getLogs('my-app', 'machine-123', { limit: 200 });

      expect(mockFetch.mock.calls[0][0]).toContain('limit=200');
    });

    it('falls back to the parsed string cursor for a non-numeric next_token', async () => {
      const raw = '{"data":[],"meta":{"next_token":"abc-cursor"}}';
      const mockFetch = vi.fn().mockResolvedValue(okText(raw));
      vi.stubGlobal('fetch', mockFetch);

      const result = await provider.getLogs('my-app', 'machine-123');

      expect(result.nextToken).toBe('abc-cursor');
    });

    it('times out the upstream Fly request (passes an abort signal)', async () => {
      const mockFetch = vi.fn().mockResolvedValue(okText('{"data":[],"meta":{}}'));
      vi.stubGlobal('fetch', mockFetch);

      await provider.getLogs('my-app', 'machine-123');

      expect(mockFetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    });

    it('forwards the nextToken cursor as the Fly next_token query param', async () => {
      const mockFetch = vi.fn().mockResolvedValue(okText('{"data":[],"meta":{}}'));
      vi.stubGlobal('fetch', mockFetch);

      await provider.getLogs('my-app', 'machine-123', { nextToken: 'cursor-abc' });

      expect(mockFetch.mock.calls[0][0]).toContain('next_token=cursor-abc');
    });

    it('throws on a non-2xx logs response', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      });
      vi.stubGlobal('fetch', mockFetch);

      await expect(provider.getLogs('my-app', 'machine-123')).rejects.toThrow(/401/);
    });
  });
});

// A definitive 404 from a machine-scoped Fly call means the machine no longer
// exists (idle reaping, out-of-band delete). The provider must translate it
// into MachineGoneError so the service layer heals stale DB rows; transient
// errors pass through, and startMachine must fail fast instead of polling the
// dead machine for 30s.
describe('FlyProvider machine-gone translation', () => {
  let provider: FlyProvider;

  beforeEach(() => {
    provider = FlyProvider.getInstance();
    vi.restoreAllMocks();
  });

  const notFound = () =>
    Promise.resolve({
      ok: false,
      status: 404,
      text: async () => 'machine not found',
    } as Response);

  it('translates 404s on machine-scoped calls into MachineGoneError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(notFound));

    await expect(provider.getMachineStatus('my-app', 'm1')).rejects.toBeInstanceOf(
      MachineGoneError
    );
    await expect(provider.getEvents('my-app', 'm1')).rejects.toBeInstanceOf(MachineGoneError);
    await expect(provider.stopMachine('my-app', 'm1')).rejects.toBeInstanceOf(MachineGoneError);
    await expect(provider.destroyMachine('my-app', 'm1')).rejects.toBeInstanceOf(
      MachineGoneError
    );
    await expect(
      provider.updateMachine({
        appId: 'my-app',
        machineId: 'm1',
        image: 'img',
        port: 8080,
        cpu: 'shared-1x',
        memory: 256,
        envVars: {},
      })
    ).rejects.toBeInstanceOf(MachineGoneError);
  });

  it('startMachine fails fast on a gone machine instead of polling for 30s', async () => {
    const mockFetch = vi.fn().mockImplementation(notFound);
    vi.stubGlobal('fetch', mockFetch);

    await expect(provider.startMachine('my-app', 'm1')).rejects.toBeInstanceOf(MachineGoneError);
    // One status poll, then immediate fail — no 1s-interval retry loop.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('does NOT translate non-404 Fly errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'internal',
      } as Response)
    );

    const err = await provider.getMachineStatus('my-app', 'm1').catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(MachineGoneError);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/500/);
  });
});
