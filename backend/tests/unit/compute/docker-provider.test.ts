import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/infra/config/app.config.js', () => {
  const c = {
    cloud: {} as Record<string, unknown>,
    app: { jwtSecret: 'test-secret' },
    docker: {
      socketPath: '/nonexistent/test.sock',
      publicHost: '',
      domain: '',
      defaultIngress: 'none',
      bindAddress: '127.0.0.1',
      // Skip own-container network discovery: it inspects the host daemon, which
      // has nothing to do with the behaviour under test here.
      isolateNetwork: true,
    },
  };
  return { config: c, appConfig: c };
});

vi.mock('@/utils/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// vi.mock factories are hoisted above const initialization, so the spies have to
// be created inside the factory and pulled back out via vi.hoisted.
const { mockRequest, mockRequestRaw } = vi.hoisted(() => ({
  mockRequest: vi.fn(),
  mockRequestRaw: vi.fn(),
}));

vi.mock('@/providers/compute/docker.client.js', async () => {
  // Keep the real demux/parse/config helpers — only the socket calls are faked.
  const actual = await vi.importActual<typeof import('@/providers/compute/docker.client.js')>(
    '@/providers/compute/docker.client.js'
  );
  return {
    ...actual,
    dockerRequest: mockRequest,
    dockerRequestRaw: mockRequestRaw,
  };
});

import { DockerProvider } from '@/providers/compute/docker.provider.js';
import { MachineGoneError } from '@/providers/compute/compute.provider.js';
import { appConfig } from '@/infra/config/app.config.js';

/** An inspect payload that passes the ownership check. */
function ownedContainer(overrides: Record<string, unknown> = {}) {
  return {
    Id: 'container-abc',
    Name: '/insforge-testkey1-api',
    State: { Status: 'running', ExitCode: 0, Running: true },
    Config: {
      Image: 'nginx:alpine',
      Labels: {
        'insforge.managed': 'true',
        'insforge.project': 'testkey1',
        'insforge.service': 'insforge-testkey1-api',
      },
    },
    NetworkSettings: { Ports: {} },
    ...overrides,
  };
}

/**
 * Queue the image-existence probe that launchMachine performs before create.
 * A 2xx means "already on this host", so no pull is attempted.
 */
function imageAlreadyPresent() {
  mockRequestRaw.mockResolvedValueOnce({ status: 200, body: Buffer.from('{}') });
}

function frame(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8');
  const header = Buffer.alloc(8);
  header[0] = 1;
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

describe('DockerProvider', () => {
  let provider: DockerProvider;
  const oldAppKey = process.env.APP_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_KEY = 'testkey1';
    provider = DockerProvider.getInstance();
  });

  afterEach(() => {
    if (oldAppKey === undefined) {
      delete process.env.APP_KEY;
    } else {
      process.env.APP_KEY = oldAppKey;
    }
    // The mocked config object is module state, so a test that changes a knob would
    // otherwise change what every later test's daemon config says.
    appConfig.docker.defaultIngress = 'none';
  });

  describe('cloud detection', () => {
    const saved = {
      profile: process.env.AWS_INSTANCE_PROFILE_NAME,
      deployment: process.env.DEPLOYMENT_ID,
      project: process.env.PROJECT_ID,
      socket: appConfig.docker.socketPath,
    };

    beforeEach(() => {
      appConfig.docker.socketPath = process.execPath;
      delete process.env.AWS_INSTANCE_PROFILE_NAME;
      delete process.env.DEPLOYMENT_ID;
      delete process.env.PROJECT_ID;
    });

    afterEach(() => {
      appConfig.docker.socketPath = saved.socket;
      for (const [key, value] of [
        ['AWS_INSTANCE_PROFILE_NAME', saved.profile],
        ['DEPLOYMENT_ID', saved.deployment],
        ['PROJECT_ID', saved.project],
      ] as const) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    });

    it('registers when PROJECT_ID is set', () => {
      process.env.PROJECT_ID = 'my-project';

      expect(provider.isConfigured()).toBe(true);
    });

    // The Zeabur template sets both ids.
    it('registers when DEPLOYMENT_ID and PROJECT_ID are both set', () => {
      process.env.DEPLOYMENT_ID = 'zeabur-service-1';
      process.env.PROJECT_ID = 'zeabur-project-1';

      expect(provider.isConfigured()).toBe(true);
    });

    it('refuses on a cloud instance', () => {
      process.env.AWS_INSTANCE_PROFILE_NAME = 'EC2-role';

      expect(provider.isConfigured()).toBe(false);
    });
  });

  describe('capabilities', () => {
    it('declares no scale-to-zero and no regions, but all three ingress modes', () => {
      expect(provider.capabilities).toEqual({
        scaleToZero: false,
        regions: false,
        ingressModes: ['none', 'port', 'host'],
        sourceBuild: 'context-upload',
        deployTokenIssuance: false,
      });
      expect(provider.name).toBe('docker');
    });

    // Not a capability: the caller-omitted default is COMPUTE_DEFAULT_INGRESS, read
    // per call. Taking it off `ingressModes[0]` is what silently disabled that
    // variable for every create.
    it('reports the configured default ingress, not the first supported mode', () => {
      expect(provider.defaultIngress()).toBe('none');

      appConfig.docker.defaultIngress = 'port';
      expect(provider.defaultIngress()).toBe('port');
      // Still a member of the declared set, which is what the interface promises.
      expect(provider.capabilities.ingressModes).toContain(provider.defaultIngress());
    });

    it('falls back to private-only when the configured value is not a mode it can deliver', () => {
      appConfig.docker.defaultIngress = 'nonsense';
      expect(provider.defaultIngress()).toBe('none');
    });
  });

  describe('resolveAppName', () => {
    // One host commonly runs several InsForge projects, so two of them deploying
    // a service called `api` must not collide on the same daemon.
    it('namespaces the container name by APP_KEY', () => {
      expect(provider.resolveAppName({ name: 'api', projectId: 'proj-1' })).toBe(
        'insforge-testkey1-api'
      );
      process.env.APP_KEY = 'otherkey';
      expect(provider.resolveAppName({ name: 'api', projectId: 'proj-2' })).toBe(
        'insforge-otherkey-api'
      );
    });
  });

  describe('launchMachine', () => {
    it('builds a spec with ownership labels, restart policy, and resource limits', async () => {
      imageAlreadyPresent();
      mockRequest.mockResolvedValueOnce({ Id: 'container-new' }).mockResolvedValueOnce(undefined);

      const result = await provider.launchMachine({
        appId: 'insforge-testkey1-api',
        image: 'nginx:alpine',
        port: 8080,
        cpu: 'shared-2x',
        memory: 512,
        envVars: { FOO: 'bar' },
        region: 'local',
      });

      expect(result).toEqual({ machineId: 'container-new', endpointUrl: null });

      const [, path, opts] = mockRequest.mock.calls[0];
      expect(path).toBe('/containers/create?name=insforge-testkey1-api');
      const body = opts.body;

      expect(body.Labels).toMatchObject({
        'insforge.managed': 'true',
        'insforge.project': 'testkey1',
        'insforge.service': 'insforge-testkey1-api',
      });
      // Spec hash is stamped so a later update can tell an in-place resize from a
      // change that needs the container recreated.
      expect(body.Labels['insforge.spec']).toMatch(/^[0-9a-f]{16}$/);
      expect(body.Env).toEqual(['FOO=bar']);
      // Survives a host reboot — measured as the difference between a container
      // coming back and staying exited.
      expect(body.HostConfig.RestartPolicy).toEqual({ Name: 'unless-stopped' });
      expect(body.HostConfig.NanoCpus).toBe(2e9);
      expect(body.HostConfig.Memory).toBe(512 * 1024 * 1024);

      // Then started.
      expect(mockRequest.mock.calls[1][1]).toBe('/containers/container-new/start');
    });

    // The security property: there is no field through which a caller could
    // smuggle Privileged, Binds, or host networking, because the spec is
    // constructed here rather than forwarded.
    it('never emits privileged, bind-mount, or host-network settings', async () => {
      imageAlreadyPresent();
      mockRequest.mockResolvedValueOnce({ Id: 'c1' }).mockResolvedValueOnce(undefined);
      await provider.launchMachine({
        appId: 'insforge-testkey1-api',
        image: 'nginx:alpine',
        port: 80,
        cpu: 'shared-1x',
        memory: 256,
        envVars: {},
        region: 'local',
      });
      const host = mockRequest.mock.calls[0][2].body.HostConfig;
      expect(host.Privileged).toBeUndefined();
      expect(host.Binds).toBeUndefined();
      expect(host.NetworkMode).toBeUndefined();
      expect(host.PidMode).toBeUndefined();
      expect(host.CapAdd).toBeUndefined();
      expect(host.Devices).toBeUndefined();
    });

    // Most compute takes no inbound traffic at all (workers, processors,
    // inference loops), so publishing a host port for every container is wrong.
    it('publishes no host port under the default `none` ingress', async () => {
      imageAlreadyPresent();
      mockRequest.mockResolvedValueOnce({ Id: 'c1' }).mockResolvedValueOnce(undefined);
      await provider.launchMachine({
        appId: 'insforge-testkey1-api',
        image: 'nginx:alpine',
        port: 8080,
        cpu: 'shared-1x',
        memory: 256,
        envVars: {},
        region: 'local',
      });
      expect(mockRequest.mock.calls[0][2].body.HostConfig.PortBindings).toEqual({});
    });

    // The bug this covers: `containers/create` does not pull, so on a host that has
    // never seen the image it fails with `No such image`. Every earlier test — unit
    // and live — pre-pulled the image, which is not what a fresh deploy does.
    it('pulls the image when the host does not have it', async () => {
      mockRequestRaw
        .mockResolvedValueOnce({ status: 404, body: Buffer.from('{"message":"No such image"}') })
        .mockResolvedValueOnce({
          status: 200,
          body: Buffer.from(
            '{"status":"Pulling from library/nginx"}\n{"status":"Download complete"}'
          ),
        });
      mockRequest.mockResolvedValueOnce({ Id: 'c-pulled' }).mockResolvedValueOnce(undefined);

      const result = await provider.launchMachine({
        appId: 'insforge-testkey1-api',
        image: 'nginx:alpine',
        port: 80,
        cpu: 'shared-1x',
        memory: 256,
        envVars: {},
        region: 'local',
      });

      expect(result.machineId).toBe('c-pulled');
      const [probe, pull] = mockRequestRaw.mock.calls;
      expect(probe[1]).toBe('/images/nginx%3Aalpine/json');
      expect(pull[0]).toBe('POST');
      expect(pull[1]).toBe('/images/create?fromImage=nginx%3Aalpine');
      // The pull must happen before create, or create sees no image.
      expect(mockRequest.mock.calls[0][1]).toContain('/containers/create');
    });

    it('does not pull when the image is already present', async () => {
      imageAlreadyPresent();
      mockRequest.mockResolvedValueOnce({ Id: 'c1' }).mockResolvedValueOnce(undefined);
      await provider.launchMachine({
        appId: 'insforge-testkey1-api',
        image: 'nginx:alpine',
        port: 80,
        cpu: 'shared-1x',
        memory: 256,
        envVars: {},
        region: 'local',
      });
      // Probe only — re-pulling on every launch would add seconds to each deploy.
      expect(mockRequestRaw.mock.calls).toHaveLength(1);
    });

    // /images/create reports failure inside the body with HTTP 200, exactly like
    // /build — so a bad image reference must not look like a successful pull.
    it('surfaces a pull failure reported inside a 200 response', async () => {
      mockRequestRaw
        .mockResolvedValueOnce({ status: 404, body: Buffer.from('{}') })
        .mockResolvedValueOnce({
          status: 200,
          body: Buffer.from(
            '{"status":"Pulling"}\n{"errorDetail":{"message":"manifest for nope:bad not found"},"error":"manifest unknown"}'
          ),
        });

      await expect(
        provider.launchMachine({
          appId: 'insforge-testkey1-api',
          image: 'nope:bad',
          port: 80,
          cpu: 'shared-1x',
          memory: 256,
          envVars: {},
          region: 'local',
        })
      ).rejects.toThrow(/manifest for nope:bad not found/);

      // Nothing was created from an image that never arrived.
      expect(mockRequest).not.toHaveBeenCalled();
    });

    it('removes the container when it is created but will not start', async () => {
      imageAlreadyPresent();
      mockRequest
        .mockResolvedValueOnce({ Id: 'c-doomed' })
        .mockRejectedValueOnce(new Error('no such image'))
        .mockResolvedValueOnce(undefined);

      await expect(
        provider.launchMachine({
          appId: 'insforge-testkey1-api',
          image: 'bad:image',
          port: 80,
          cpu: 'shared-1x',
          memory: 256,
          envVars: {},
          region: 'local',
        })
      ).rejects.toThrow('no such image');

      // A container that cannot start must not linger looking deployable.
      expect(mockRequest.mock.calls[2]).toEqual(['DELETE', '/containers/c-doomed?force=true']);
    });
  });

  describe('updateMachine', () => {
    const baseSpec = {
      appId: 'insforge-testkey1-api',
      image: 'nginx:alpine',
      port: 8080,
      cpu: 'shared-1x',
      memory: 256,
      envVars: { FOO: 'bar' },
    };

    /** Launch once to learn the spec hash the provider stamps for a given spec. */
    async function hashFor(spec: typeof baseSpec) {
      mockRequest.mockReset();
      mockRequestRaw.mockReset();
      imageAlreadyPresent();
      mockRequest.mockResolvedValueOnce({ Id: 'x' }).mockResolvedValueOnce(undefined);
      await provider.launchMachine({ ...spec, region: 'local' });
      const labels = mockRequest.mock.calls[0][2].body.Labels as Record<string, string>;
      mockRequest.mockReset();
      return labels['insforge.spec'];
    }

    it('resizes cpu/memory in place when the immutable spec is unchanged', async () => {
      const spec = await hashFor(baseSpec);
      mockRequest
        .mockResolvedValueOnce(
          ownedContainer({
            Config: {
              Image: 'nginx:alpine',
              Labels: {
                'insforge.managed': 'true',
                'insforge.project': 'testkey1',
                'insforge.spec': spec,
              },
            },
          })
        )
        .mockResolvedValueOnce(undefined);

      // Same image/port/env, bigger box.
      const result = await provider.updateMachine({
        ...baseSpec,
        machineId: 'container-abc',
        cpu: 'shared-4x',
        memory: 1024,
      });

      expect(result).toEqual({});
      expect(mockRequest.mock.calls[1][1]).toBe('/containers/container-abc/update');
      expect(mockRequest.mock.calls[1][2].body).toEqual({
        NanoCpus: 4e9,
        Memory: 1024 * 1024 * 1024,
      });
    });

    // The bug this guards: Docker cannot swap a running container's image, so
    // applying only cpu/memory would report success while the old image keeps
    // serving and the database records the new one.
    it('recreates the container when the image changes, and reports the new id', async () => {
      const oldSpec = await hashFor(baseSpec);
      mockRequest
        .mockResolvedValueOnce(
          ownedContainer({
            Name: '/insforge-testkey1-api',
            Config: {
              Image: 'nginx:alpine',
              Labels: {
                'insforge.managed': 'true',
                'insforge.project': 'testkey1',
                'insforge.spec': oldSpec,
              },
            },
          })
        )
        .mockResolvedValueOnce(undefined) // stop
        .mockResolvedValueOnce(undefined) // remove
        .mockResolvedValueOnce({ Id: 'container-new' }) // create
        .mockResolvedValueOnce(undefined); // start
      imageAlreadyPresent();

      const result = await provider.updateMachine({
        ...baseSpec,
        machineId: 'container-abc',
        image: 'nginx:1.27-alpine',
      });

      expect(result).toEqual({ machineId: 'container-new', endpointUrl: null });
      const paths = mockRequest.mock.calls.map((c) => `${c[0]} ${c[1]}`);
      expect(paths).toEqual([
        'GET /containers/container-abc/json',
        'POST /containers/container-abc/stop',
        'DELETE /containers/container-abc?force=true',
        'POST /containers/create?name=insforge-testkey1-api',
        'POST /containers/container-new/start',
      ]);
      // Replacement runs the requested image, under the original name.
      expect(mockRequest.mock.calls[3][2].body.Image).toBe('nginx:1.27-alpine');
    });

    // Removing an env var is invisible if you only check that the requested ones
    // are present, which is why the decision is hash-based.
    it('recreates when an env var is removed', async () => {
      const twoVars = await hashFor({ ...baseSpec, envVars: { FOO: 'bar', BAZ: 'qux' } });
      mockRequest
        .mockResolvedValueOnce(
          ownedContainer({
            Config: {
              Image: 'nginx:alpine',
              Labels: {
                'insforge.managed': 'true',
                'insforge.project': 'testkey1',
                'insforge.spec': twoVars,
              },
            },
          })
        )
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ Id: 'container-new' })
        .mockResolvedValueOnce(undefined);
      imageAlreadyPresent();

      const result = await provider.updateMachine({
        ...baseSpec,
        machineId: 'container-abc',
        envVars: { FOO: 'bar' }, // BAZ dropped
      });
      expect(result).toEqual({ machineId: 'container-new', endpointUrl: null });
    });

    it('is insensitive to env var ordering', async () => {
      const spec = await hashFor({ ...baseSpec, envVars: { A: '1', B: '2' } });
      mockRequest
        .mockResolvedValueOnce(
          ownedContainer({
            Config: {
              Image: 'nginx:alpine',
              Labels: {
                'insforge.managed': 'true',
                'insforge.project': 'testkey1',
                'insforge.spec': spec,
              },
            },
          })
        )
        .mockResolvedValueOnce(undefined);

      const result = await provider.updateMachine({
        ...baseSpec,
        machineId: 'container-abc',
        envVars: { B: '2', A: '1' },
      });
      // Same set, different order — must not churn the container.
      expect(result).toEqual({});
    });
  });

  describe('ownership scoping', () => {
    // Measured on a real host: from inside a container with the socket mounted,
    // an unfiltered listing includes Postgres and the backend itself. Acting on
    // an id without checking labels is how a stop takes out the database.
    it('refuses to act on a container that is not ours', async () => {
      mockRequest.mockResolvedValueOnce({
        Id: 'postgres-container',
        Name: '/insforge_postgres_1',
        State: { Status: 'running', ExitCode: 0, Running: true },
        Config: { Image: 'postgres:15', Labels: { 'com.docker.compose.service': 'postgres' } },
        NetworkSettings: {},
      });

      await expect(provider.stopMachine('whatever', 'postgres-container')).rejects.toThrow(
        MachineGoneError
      );
      // Crucially, the stop itself was never issued.
      expect(mockRequest).toHaveBeenCalledTimes(1);
    });

    it('refuses a container belonging to another project on the same host', async () => {
      mockRequest.mockResolvedValueOnce(
        ownedContainer({
          Config: {
            Image: 'nginx',
            Labels: { 'insforge.managed': 'true', 'insforge.project': 'someoneelse' },
          },
        })
      );
      await expect(provider.destroyMachine('app', 'container-abc')).rejects.toThrow(
        MachineGoneError
      );
      expect(mockRequest).toHaveBeenCalledTimes(1);
    });

    it('acts on a container that carries our labels', async () => {
      mockRequest.mockResolvedValueOnce(ownedContainer()).mockResolvedValueOnce(undefined);
      await provider.stopMachine('insforge-testkey1-api', 'container-abc');
      expect(mockRequest.mock.calls[1][1]).toBe('/containers/container-abc/stop');
    });
  });

  describe('listMachines', () => {
    // Docker's name filter is an unanchored regex over container names, so a bare
    // `api` also matches `api-v2`. Reporting a sibling service's container as this
    // service's instance is the kind of mistake that ends with the wrong container
    // being stopped.
    it('anchors the name filter and drops any prefix match that slips through', async () => {
      mockRequest.mockResolvedValueOnce([
        { Id: 'right', State: 'running', Names: ['/insforge-testkey1-api'] },
        { Id: 'wrong', State: 'running', Names: ['/insforge-testkey1-api-v2'] },
      ]);

      const list = await provider.listMachines('insforge-testkey1-api');

      const url = mockRequest.mock.calls[0][1] as string;
      const filters = JSON.parse(decodeURIComponent(url.split('filters=')[1]));
      expect(filters.name).toEqual(['^/?insforge-testkey1-api$']);
      expect(list.map((m) => m.id)).toEqual(['right']);
    });
  });

  describe('state mapping', () => {
    // Measured across a real host reboot: cleanly-stopped containers reported
    // `Exited (0)` while host-killed ones reported `Exited (137)` (SIGKILL).
    // Mapping a non-zero exit to `failed` would mark a chunk of services failed
    // after every reboot.
    it('maps exited to stopped regardless of exit code, including SIGKILL', async () => {
      for (const exitCode of [0, 1, 137]) {
        mockRequest.mockResolvedValueOnce(
          ownedContainer({ State: { Status: 'exited', ExitCode: exitCode, Running: false } })
        );
        const { state } = await provider.getMachineStatus('app', 'container-abc');
        expect(state).toBe('stopped');
      }
    });

    it('maps the remaining Docker states onto the service enum', async () => {
      const cases: [string, string][] = [
        ['running', 'running'],
        ['restarting', 'running'],
        ['created', 'creating'],
        ['removing', 'destroying'],
        ['dead', 'failed'],
        ['paused', 'stopped'],
      ];
      for (const [docker, expected] of cases) {
        mockRequest.mockResolvedValueOnce(
          ownedContainer({ State: { Status: docker, ExitCode: 0, Running: false } })
        );
        const { state } = await provider.getMachineStatus('app', 'container-abc');
        expect(state, `docker "${docker}"`).toBe(expected);
      }
    });
  });

  describe('getLogs', () => {
    it('demuxes frames and returns a nanosecond watermark as the cursor', async () => {
      mockRequest.mockResolvedValueOnce(ownedContainer());
      mockRequestRaw.mockResolvedValueOnce({
        status: 200,
        body: Buffer.concat([
          frame('2026-08-06T22:51:32.781160549Z line-1\n'),
          frame('2026-08-06T22:51:33.785353049Z line-2\n'),
        ]),
      });

      const result = await provider.getLogs('app', 'container-abc');

      expect(result.lines).toEqual([
        { timestamp: Date.parse('2026-08-06T22:51:32.781Z'), message: 'line-1' },
        { timestamp: Date.parse('2026-08-06T22:51:33.785Z'), message: 'line-2' },
      ]);
      // Cursor carries full nanosecond precision, not the millisecond timestamp.
      expect(result.nextToken).toBe('1786056693785353049');
    });

    // `since` accepts integer seconds only and is inclusive, so the boundary
    // second is always re-delivered. Dedup therefore has to happen against the
    // nanosecond watermark — filtering by second would drop genuinely new lines
    // that share a second with the previous batch.
    it('floors the cursor to seconds on the wire but dedupes by nanosecond', async () => {
      mockRequest.mockResolvedValueOnce(ownedContainer());
      mockRequestRaw.mockResolvedValueOnce({
        status: 200,
        body: Buffer.concat([
          frame('2026-08-06T22:51:33.100000000Z already-seen\n'),
          frame('2026-08-06T22:51:33.200000000Z also-seen\n'),
          frame('2026-08-06T22:51:33.300000000Z brand-new\n'),
        ]),
      });

      const result = await provider.getLogs('app', 'container-abc', {
        nextToken: '1786056693200000000', // the .2 line
      });

      // Same second as the watermark, but later — must survive.
      expect(result.lines.map((l) => l.message)).toEqual(['brand-new']);
      expect(result.nextToken).toBe('1786056693300000000');

      const url = mockRequestRaw.mock.calls[0][1] as string;
      expect(url).toContain('since=1786056693');
      expect(url).toContain('timestamps=1');
    });

    it('treats an unreadable cursor as absent rather than failing the request', async () => {
      mockRequest.mockResolvedValueOnce(ownedContainer());
      mockRequestRaw.mockResolvedValueOnce({
        status: 200,
        body: frame('2026-08-06T22:51:32.000000000Z hello\n'),
      });
      const result = await provider.getLogs('app', 'container-abc', { nextToken: 'garbage' });
      expect(result.lines.map((l) => l.message)).toEqual(['hello']);
      expect(mockRequestRaw.mock.calls[0][1]).not.toContain('since=');
    });

    it('returns a null cursor when there is nothing to page from', async () => {
      mockRequest.mockResolvedValueOnce(ownedContainer());
      mockRequestRaw.mockResolvedValueOnce({ status: 200, body: Buffer.alloc(0) });
      const result = await provider.getLogs('app', 'container-abc');
      expect(result).toEqual({ lines: [], nextToken: null });
    });

    // `tail` keeps the newest N. Pairing it with `since` would return the newest
    // N of the backlog and then advance the cursor past everything older, which
    // no later request could reach — the middle of the backlog would be gone.
    it('asks for a tail on the first page but not when resuming from a cursor', async () => {
      mockRequest.mockResolvedValueOnce(ownedContainer());
      mockRequestRaw.mockResolvedValueOnce({ status: 200, body: Buffer.alloc(0) });
      await provider.getLogs('app', 'container-abc', { limit: 50 });
      expect(mockRequestRaw.mock.calls[0][1]).toContain('tail=50');

      mockRequest.mockResolvedValueOnce(ownedContainer());
      mockRequestRaw.mockResolvedValueOnce({ status: 200, body: Buffer.alloc(0) });
      await provider.getLogs('app', 'container-abc', {
        limit: 50,
        nextToken: '1786056693200000000',
      });
      const resumed = mockRequestRaw.mock.calls[1][1] as string;
      expect(resumed).toContain('since=1786056693');
      expect(resumed).not.toContain('tail=');
    });

    /**
     * Mock what the daemon would actually send for a given request, so the mock
     * cannot assert a shape the real thing never produces: `tail=N` returns the
     * *newest* N, and `since` alone returns everything after that second.
     */
    function daemonLogs(lines: { nanos: string; message: string }[]) {
      return (_method: string, url: string) => {
        const params = new URLSearchParams(url.split('?')[1] ?? '');
        let out = lines;
        const since = params.get('since');
        if (since !== null) {
          out = out.filter((l) => BigInt(l.nanos) / 1_000_000_000n >= BigInt(since));
        }
        const tail = params.get('tail');
        if (tail !== null) {
          out = out.slice(-Number(tail));
        }
        const iso = (nanos: string) => {
          const ns = BigInt(nanos);
          const ms = new Date(Number(ns / 1_000_000n)).toISOString().replace('Z', '');
          return `${ms.slice(0, 19)}.${String(ns % 1_000_000_000n).padStart(9, '0')}Z`;
        };
        return Promise.resolve({
          status: 200,
          body: Buffer.concat(out.map((l) => frame(`${iso(l.nanos)} ${l.message}\n`))),
        });
      };
    }

    // One second apart, so every `since` boundary lands on a distinct line.
    const FIVE_LINES = Array.from({ length: 5 }, (_, i) => ({
      nanos: String(1786056700000000000n + BigInt(i) * 1_000_000_000n),
      message: `line-${i}`,
    }));

    // First page asks for `tail`, so the daemon hands back the newest `limit` —
    // "most recent logs" is what a caller with no cursor wants.
    it('returns the newest lines on a first page, per `tail` semantics', async () => {
      mockRequest.mockResolvedValueOnce(ownedContainer());
      mockRequestRaw.mockImplementationOnce(daemonLogs(FIVE_LINES));

      const first = await provider.getLogs('app', 'container-abc', { limit: 2 });

      expect(first.lines.map((l) => l.message)).toEqual(['line-3', 'line-4']);
      expect(first.nextToken).toBe(FIVE_LINES[4].nanos);
    });

    // Resuming sends no `tail`, so the daemon returns the whole backlog and the
    // trimming happens here. This is the only path where more lines arrive than
    // were asked for, and the property under test is that paging reaches them all
    // rather than jumping to the newest.
    it('pages through a backlog larger than `limit` without skipping lines', async () => {
      const seen: string[] = [];
      let token: string | null = null;

      // Start from before the first line so the whole backlog is "new".
      token = String(BigInt(FIVE_LINES[0].nanos) - 1_000_000_000n);
      for (let page = 0; page < 3; page++) {
        mockRequest.mockResolvedValueOnce(ownedContainer());
        mockRequestRaw.mockImplementationOnce(daemonLogs(FIVE_LINES));
        const res = await provider.getLogs('app', 'container-abc', {
          limit: 2,
          nextToken: token as string,
        });
        seen.push(...res.lines.map((l) => l.message));
        token = res.nextToken;
      }

      // Every line, in order, once — the failure this guards against is pages of
      // ['line-3','line-4'] repeating while 0-2 are never delivered.
      expect(seen).toEqual(['line-0', 'line-1', 'line-2', 'line-3', 'line-4']);
    });
  });

  describe('project network discovery', () => {
    // A cached null would detach every later container from the project network
    // for the rest of the process lifetime, so a failed inspect must not stick.
    it('retries after a failed self-inspect instead of caching the failure', async () => {
      const { config } = await import('@/infra/config/app.config.js');
      const isolated = config.docker.isolateNetwork;
      config.docker.isolateNetwork = false;
      try {
        const fresh = new DockerProvider();
        const params = {
          appId: 'insforge-testkey1-api',
          image: 'nginx:alpine',
          port: 80,
          cpu: 'shared-1x',
          memory: 256,
          region: 'local',
        };
        const createBody = () =>
          mockRequest.mock.calls.find((c) => String(c[1]).includes('/containers/create'))?.[2]
            ?.body;

        // First launch: the self-inspect blips, so we fall back to the bridge.
        imageAlreadyPresent();
        mockRequest.mockRejectedValueOnce(new Error('daemon restarting'));
        mockRequest.mockResolvedValueOnce({ Id: 'new-1' });
        mockRequest.mockResolvedValueOnce(undefined);
        await fresh.launchMachine(params);
        expect(createBody()?.NetworkingConfig).toBeUndefined();

        // Second launch: the daemon is back, so the network is found and used.
        mockRequest.mockClear();
        imageAlreadyPresent();
        mockRequest.mockResolvedValueOnce({
          NetworkSettings: { Networks: { bridge: {}, 'myproj_insforge-network': {} } },
        });
        mockRequest.mockResolvedValueOnce({ Id: 'new-2' });
        mockRequest.mockResolvedValueOnce(undefined);
        await fresh.launchMachine(params);
        expect(createBody()?.NetworkingConfig).toEqual({
          EndpointsConfig: { 'myproj_insforge-network': {} },
        });
      } finally {
        config.docker.isolateNetwork = isolated;
      }
    });
  });

  describe('endpointUrl', () => {
    // Returning a plausible-looking URL that times out is worse than returning
    // nothing: measured on EC2, a closed security group makes a published port
    // hang with no diagnostic.
    it('is null under `none` ingress, where nothing is published', () => {
      expect(provider.endpointUrl('insforge-testkey1-api')).toBeNull();
    });
  });
});
