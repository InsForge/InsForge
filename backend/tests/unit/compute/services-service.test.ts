import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { ERROR_CODES } from '@insforge/shared-schemas';
import type { AppError } from '@/utils/errors.js';

// --- Mocks ---

const mockQuery = vi.fn();
const mockPool = { query: mockQuery };

vi.mock('@/infra/database/database.manager.js', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => mockPool,
    }),
  },
}));

vi.mock('@/infra/security/encryption.manager.js', () => ({
  EncryptionManager: {
    encrypt: vi.fn((v: string) => `encrypted:${v}`),
    decrypt: vi.fn((v: string) => v.replace('encrypted:', '')),
  },
}));

vi.mock('@/infra/config/app.config.js', () => {
  const c = {
    fly: {
      enabled: true,
      apiToken: 'test-token',
      org: 'test-org',
      domain: 'fly.dev',
    },
    docker: { socketPath: '/nonexistent/insforge-test-docker.sock' },
    cloud: {
      projectId: '',
      apiHost: '',
    },
    app: {
      jwtSecret: 'test-secret',
    },
    storage: {
      appKey: 'testkey1',
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

const mockCreateApp = vi.fn();
const mockDestroyApp = vi.fn();
const mockLaunchMachine = vi.fn();
const mockUpdateMachine = vi.fn();
const mockStopMachine = vi.fn();
const mockStartMachine = vi.fn();
const mockDestroyMachine = vi.fn();
const mockGetEvents = vi.fn();
const mockGetLogs = vi.fn();
const mockListMachines = vi.fn();
// reconcile is the first caller of these two, so they were not mocked before.
const mockGetMachineStatus = vi.fn();
const mockWaitForState = vi.fn();
const mockIsConfigured = vi.fn(() => true);

/**
 * Canonical Fly capabilities. Tests that need a different shape assign onto
 * `mockFlyInstance.capabilities`; `beforeEach` restores from this, so a test that
 * throws mid-body cannot leak its mutation into everything that follows.
 */
const FLY_CAPABILITIES = {
  scaleToZero: true,
  regions: true,
  ingressModes: ['host'] as ('none' | 'port' | 'host')[],
  sourceBuild: 'flyctl' as const,
  deployTokenIssuance: false,
};

const mockFlyInstance = {
  createApp: mockCreateApp,
  destroyApp: mockDestroyApp,
  launchMachine: mockLaunchMachine,
  updateMachine: mockUpdateMachine,
  stopMachine: mockStopMachine,
  startMachine: mockStartMachine,
  destroyMachine: mockDestroyMachine,
  getEvents: mockGetEvents,
  getLogs: mockGetLogs,
  listMachines: mockListMachines,
  getMachineStatus: mockGetMachineStatus,
  waitForState: mockWaitForState,
  isConfigured: mockIsConfigured,
  // Provider-neutral surface (migration 064 / capability descriptor). The real
  // FlyProvider derives these itself; the mock mirrors its behaviour so the
  // service's naming and URL calls resolve to the same values the fixtures use.
  name: 'fly' as const,
  capabilities: { ...FLY_CAPABILITIES },
  // Fly's only mode. A separate method rather than capabilities.ingressModes[0]
  // because a single-host driver's default is an operator setting.
  defaultIngress: (): 'none' | 'port' | 'host' => 'host',
  // Delegates to the real helper (rather than a naive template) so the service
  // test keeps covering the Fly app-name length guard, which moved here from
  // the service layer.
  resolveAppName: (params: { name: string; projectId: string }) => flyAppNameFor(params),
  endpointUrl: (appId: string) => `https://${appId}.fly.dev`,
};

vi.mock('@/providers/compute/fly.provider.js', () => ({
  FlyProvider: {
    getInstance: () => mockFlyInstance,
  },
}));

import { ComputeServicesService } from '@/services/compute/services.service.js';
import { MachineGoneError, flyAppNameFor } from '@/providers/compute/compute.provider.js';

// Cleared per test; the cloud cases set it. File-level: the suites below are separate
// top-level describes.
const savedAwsProfile = process.env.AWS_INSTANCE_PROFILE_NAME;

beforeEach(() => {
  delete process.env.AWS_INSTANCE_PROFILE_NAME;
});

afterAll(() => {
  if (savedAwsProfile === undefined) {
    delete process.env.AWS_INSTANCE_PROFILE_NAME;
  } else {
    process.env.AWS_INSTANCE_PROFILE_NAME = savedAwsProfile;
  }
});

describe('ComputeServicesService', () => {
  let service: ComputeServicesService;

  const oldEnvAppKey = process.env.APP_KEY;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env.APP_KEY = 'testkey1';
    service = ComputeServicesService.getInstance();
    mockIsConfigured.mockReturnValue(true);
    // The mock provider is a module-scoped singleton, so a capability override
    // survives the test that made it. Restore here rather than at the end of each
    // test body, where a failing assertion skips the restore and the leak shows up
    // as unrelated failures further down the file.
    mockFlyInstance.capabilities = { ...FLY_CAPABILITIES };
    mockFlyInstance.defaultIngress = () => 'host';
  });

  afterEach(() => {
    if (oldEnvAppKey === undefined) {
      delete process.env.APP_KEY;
    } else {
      process.env.APP_KEY = oldEnvAppKey;
    }
  });

  describe('driver routing and capabilities', () => {
    // Served as the `compute` slice of /api/metadata rather than its own endpoint:
    // the CLI already capability-probes through metadata slices, and a second
    // mechanism for "what can this deployment do" would drift from the first.
    it('reports the compute metadata slice keyed by provider', async () => {
      const { getComputeMetadata } = await import('@/services/compute/services.service.js');
      expect(getComputeMetadata()).toEqual({
        defaultProvider: 'fly',
        providers: {
          fly: {
            scaleToZero: true,
            regions: true,
            ingressModes: ['host'],
            // Resolved from the provider, not read off ingressModes[0]: a
            // single-host driver's default is an operator setting, and a client
            // that guessed would preselect one mode and be given another.
            defaultIngress: 'host',
            sourceBuild: 'flyctl',
            deployTokenIssuance: false,
          },
        },
      });
    });

    // A stored value the driver cannot honour is worse than a rejected request:
    // nothing later contradicts it, so the API and dashboard keep reporting a
    // region the container is not in. The CLI defaults `--region iad`, so this
    // path is hit by every Docker deploy from an unmodified CLI.
    it('records a capability-less region as local instead of the requested value', async () => {
      mockFlyInstance.capabilities = { ...mockFlyInstance.capabilities, regions: false };
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 's1', provider: 'fly' }] });
      mockCreateApp.mockResolvedValue({ appId: 'a' });
      mockLaunchMachine.mockResolvedValue({ machineId: 'm1' });
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 's1', provider: 'fly', region: 'local' }] });

      await service.createService({
        projectId: 'proj-123',
        name: 'svc',
        imageUrl: 'nginx',
        port: 80,
        cpu: 'shared-1x',
        memory: 256,
        region: 'iad',
      });

      // The INSERT stores `local`, and the launch is told the same thing.
      expect(mockQuery.mock.calls[0][1]).toContain('local');
      expect(mockQuery.mock.calls[0][1]).not.toContain('iad');
      expect(mockLaunchMachine.mock.calls[0][0].region).toBe('local');
    });

    // Found by the first end-to-end run: the API default for scaleToZero is
    // `true`, so omitting it stored `true` against a driver that cannot do it.
    // Coercing only an explicit `true` missed the common path.
    it('records always-on even when the caller omits scaleToZero entirely', async () => {
      mockFlyInstance.capabilities = { ...mockFlyInstance.capabilities, scaleToZero: false };
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 's1', provider: 'fly' }] });
      mockCreateApp.mockResolvedValue({ appId: 'a' });
      mockLaunchMachine.mockResolvedValue({ machineId: 'm1' });
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 's1', provider: 'fly' }] });

      await service.createService({
        projectId: 'proj-123',
        name: 'svc',
        imageUrl: 'nginx',
        port: 80,
        cpu: 'shared-1x',
        memory: 256,
        region: 'iad',
        // scaleToZero deliberately not sent
      });

      // The INSERT must persist false, not the schema default of true.
      expect(mockQuery.mock.calls[0][1]).toContain(false);
      expect(mockLaunchMachine.mock.calls[0][0].scaleToZero).toBe(false);
    });

    // Found while verifying the settings dialog on a real daemon: an omitted ingress
    // used to resolve to `capabilities.ingressModes[0]`, a static list whose first
    // entry is 'none'. That made COMPUTE_DEFAULT_INGRESS — and the stored setting
    // that replaces it — have no effect on service creation.
    it("applies the driver's configured default ingress when the caller omits it", async () => {
      mockFlyInstance.capabilities = {
        ...mockFlyInstance.capabilities,
        ingressModes: ['none', 'port', 'host'],
      };
      mockFlyInstance.defaultIngress = () => 'port';
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 's1', provider: 'fly' }] });
      mockCreateApp.mockResolvedValue({ appId: 'a' });
      mockLaunchMachine.mockResolvedValue({ machineId: 'm1' });
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 's1', provider: 'fly' }] });

      await service.createService({
        projectId: 'proj-123',
        name: 'svc',
        imageUrl: 'nginx',
        port: 80,
        cpu: 'shared-1x',
        memory: 256,
        region: 'iad',
        // ingress deliberately not sent
      });

      // Both the stored row and the launch call, because a row that disagrees with
      // the container is the failure this whole capability layer exists to prevent.
      expect(mockQuery.mock.calls[0][1]).toContain('port');
      expect(mockLaunchMachine.mock.calls[0][0].ingress).toBe('port');
    });

    // The old check read appConfig and lived inside buildComputeRegistry, which runs on
    // every /api/metadata request — so an operator who set the org through the
    // dashboard was told, on every dashboard poll, to set a value they had set. It now
    // reads the credentials in force and runs once at startup.
    it('warns about a token with no org, and stays quiet when both are in force', async () => {
      const { warnIfFlyCredentialsIncomplete } =
        await import('@/services/compute/services.service.js');
      const logger = (await import('@/utils/logger.js')).default;
      const { appConfig } = await import('@/infra/config/app.config.js');
      const said = () =>
        vi
          .mocked(logger.warn)
          .mock.calls.flat()
          .some((arg) => typeof arg === 'string' && arg.includes('the org is empty'));

      const original = appConfig.fly.org;
      try {
        appConfig.fly.org = '';
        warnIfFlyCredentialsIncomplete();
        expect(said()).toBe(true);

        vi.mocked(logger.warn).mockClear();
        appConfig.fly.org = 'test-org';
        warnIfFlyCredentialsIncomplete();
        expect(said()).toBe(false);
      } finally {
        // Restored even if an assertion throws: appConfig is module state shared with
        // every sibling test, and `''` leaking would quietly change what they exercise.
        appConfig.fly.org = original;
      }
    });

    // Provider is the dashboard's navigation axis, so a create from Fly's page has to
    // land on Fly even when Docker is the deployment default. Before this the service
    // layer always used the default and the page filtered its own new service out.
    it('creates on the provider the caller names, not the default', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 's1', provider: 'fly' }] });
      mockCreateApp.mockResolvedValue({ appId: 'a' });
      mockLaunchMachine.mockResolvedValue({ machineId: 'm1' });
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 's1', provider: 'fly' }] });

      await service.createService({
        projectId: 'proj-123',
        name: 'svc',
        provider: 'fly',
        imageUrl: 'nginx',
        port: 80,
        cpu: 'shared-1x',
        memory: 256,
        region: 'iad',
      });

      expect(mockCreateApp).toHaveBeenCalled();
    });

    // Silently swapping the driver would store a row that says one thing while the
    // container runs somewhere else.
    it('rejects a provider this deployment does not have', async () => {
      await expect(
        service.createService({
          projectId: 'proj-123',
          name: 'svc',
          provider: 'docker',
          imageUrl: 'nginx',
          port: 80,
          cpu: 'shared-1x',
          memory: 256,
          region: 'iad',
        })
      ).rejects.toThrow(/not configured on this deployment/i);
      expect(mockCreateApp).not.toHaveBeenCalled();
    });

    // On update, an omitted field means "leave it alone". Filling it in would turn
    // a metadata-only PATCH into a deploy change and call the provider needlessly.
    it('does not invent a scaleToZero change on an update that omits it', async () => {
      mockFlyInstance.capabilities = { ...mockFlyInstance.capabilities, scaleToZero: false };
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 's1',
            name: 'svc',
            provider: 'fly',
            provider_app_id: 'a',
            provider_instance_id: 'm1',
            status: 'running',
            cpu: 'shared-1x',
            region: 'local',
            ingress: 'host',
            scale_to_zero: false,
          },
        ],
      });
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 's1', provider: 'fly' }] });

      await service.updateService('s1', { region: 'local' });

      // Region-only change: no deploy-affecting field was implied, so the provider
      // was never asked to update the instance.
      expect(mockUpdateMachine).not.toHaveBeenCalled();
    });

    it('records a service as always-on when the driver cannot scale to zero', async () => {
      mockFlyInstance.capabilities = { ...mockFlyInstance.capabilities, scaleToZero: false };
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 's1', provider: 'fly' }] });
      mockCreateApp.mockResolvedValue({ appId: 'a' });
      mockLaunchMachine.mockResolvedValue({ machineId: 'm1' });
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 's1', provider: 'fly' }] });

      await service.createService({
        projectId: 'proj-123',
        name: 'svc',
        imageUrl: 'nginx',
        port: 80,
        cpu: 'shared-1x',
        memory: 256,
        region: 'iad',
        scaleToZero: true,
      });

      expect(mockLaunchMachine.mock.calls[0][0].scaleToZero).toBe(false);
    });

    // prepareForDeploy reserves a name and creates the provider-side app, then
    // waits for a build. On a driver with no source-build path, succeeding would
    // strand the row in `deploying` with nothing able to advance it — the exact
    // shape of the self-host Fly bug this work exists to stop repeating.
    it('rejects prepareForDeploy on a driver that cannot build from source', async () => {
      mockFlyInstance.capabilities = { ...mockFlyInstance.capabilities, sourceBuild: 'none' };

      await expect(
        service.prepareForDeploy({
          projectId: 'proj-123',
          name: 'svc',
          port: 80,
          cpu: 'shared-1x',
          memory: 256,
          region: 'iad',
        })
      ).rejects.toThrow(/cannot build from source/);

      // Nothing was written and no provider-side app was created.
      expect(mockQuery).not.toHaveBeenCalled();
      expect(mockCreateApp).not.toHaveBeenCalled();
    });

    // Drivers coexist, so a row is routed by its own `provider`. When that
    // driver isn't configured here we must refuse rather than hand Docker a Fly
    // machine id (or vice versa) — that would 404 confusingly at best, and at
    // worst heal a live, billing machine into a `stopped` row.
    it('refuses machine operations on a row whose driver is not configured', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'svc-docker-1',
            project_id: 'proj-123',
            name: 'local-worker',
            image_url: 'nginx:alpine',
            port: 8080,
            cpu: 'shared-1x',
            memory: 512,
            region: 'local',
            provider: 'docker',
            provider_app_id: 'insforge-local-worker',
            provider_instance_id: 'container-abc',
            status: 'running',
            endpoint_url: null,
            created_at: 'now',
            updated_at: 'now',
          },
        ],
      });

      await expect(service.stopService('svc-docker-1')).rejects.toThrow(/"docker".*not configured/);
      expect(mockStopMachine).not.toHaveBeenCalled();
    });
  });

  // Reconcile exists for drift that accumulates while the backend is down, which
  // is precisely the state no request-path test ever reaches.
  describe('reconcile', () => {
    function row(overrides: Record<string, unknown> = {}) {
      return {
        id: 'svc-1',
        name: 'worker',
        provider: 'fly',
        provider_app_id: 'app-1',
        provider_instance_id: 'machine-1',
        status: 'running',
        cpu: 'shared-1x',
        ...overrides,
      };
    }

    it('corrects a row that says running when the instance is stopped', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [row()] });
      mockGetMachineStatus.mockResolvedValueOnce({ state: 'stopped' });
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const stats = await service.reconcile();

      expect(stats).toMatchObject({ checked: 1, corrected: 1, healed: 0 });
      const [sql, params] = mockQuery.mock.calls[1];
      expect(sql).toContain('SET status = $1');
      // Scoped to the instance the reading was taken against, so a deploy that
      // replaced it concurrently is not overwritten by a stale observation.
      expect(sql).toContain('provider_instance_id = $3');
      expect(params).toEqual(['stopped', 'svc-1', 'machine-1']);
    });

    // The guard firing is the normal outcome of a race, not a correction. Counting
    // it as one would report work that never happened and hide how often the race
    // actually fires.
    it('reports a skip, not a correction, when the guard blocks the write', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [row()] });
      mockGetMachineStatus.mockResolvedValueOnce({ state: 'stopped' });
      // A concurrent deploy already replaced provider_instance_id, so the guarded
      // UPDATE matches nothing.
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const stats = await service.reconcile();

      expect(stats).toMatchObject({ checked: 1, corrected: 0, skipped: 1, healed: 0 });
    });

    it('leaves a row alone when reality already matches', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [row()] });
      mockGetMachineStatus.mockResolvedValueOnce({ state: 'running' });

      const stats = await service.reconcile();

      expect(stats).toMatchObject({ checked: 1, corrected: 0 });
      expect(mockQuery).toHaveBeenCalledTimes(1); // read only, no write
    });

    it('heals a row whose instance is gone entirely', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [row()] });
      mockGetMachineStatus.mockRejectedValueOnce(new MachineGoneError('app-1', 'machine-1'));
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const stats = await service.reconcile();

      expect(stats).toMatchObject({ healed: 1 });
      // Healing clears the dead pointer so the next deploy relaunches.
      expect(mockQuery.mock.calls[1][0]).toContain('provider_instance_id = NULL');
    });

    // Deciding what a half-finished create should become means guessing whether
    // provider-side resources exist; guessing wrong destroys a service.
    it('reports but does not touch rows left in a transient state', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [row({ status: 'deploying' }), row({ id: 'svc-2', status: 'destroying' })],
      });

      const stats = await service.reconcile();

      expect(stats).toMatchObject({ skipped: 2, checked: 0, corrected: 0 });
      expect(mockGetMachineStatus).not.toHaveBeenCalled();
    });

    it('skips rows belonging to a driver that is not configured', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [row({ provider: 'docker' })] });

      const stats = await service.reconcile();

      expect(stats).toMatchObject({ skipped: 1, checked: 0 });
      expect(mockGetMachineStatus).not.toHaveBeenCalled();
    });

    // A daemon restarting mid-reconcile must not be mistaken for "instance gone".
    it('leaves a row unchanged on a transient provider error', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [row()] });
      mockGetMachineStatus.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const stats = await service.reconcile();

      expect(stats).toMatchObject({ checked: 1, corrected: 0, healed: 0 });
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('survives a database read failure without throwing into startup', async () => {
      mockQuery.mockRejectedValueOnce(new Error('connection terminated'));
      await expect(service.reconcile()).resolves.toMatchObject({ checked: 0 });
    });

    // The heal is a write inside the catch block. Letting it throw would escape
    // the loop and abandon every row after it — nine healthy corrections lost to
    // one bad write.
    it('keeps sweeping when a heal write fails', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [row(), row({ id: 'svc-2', name: 'api', provider_instance_id: 'machine-2' })],
      });
      mockGetMachineStatus
        .mockRejectedValueOnce(new MachineGoneError('app-1', 'machine-1'))
        .mockResolvedValueOnce({ state: 'stopped' });
      mockQuery.mockRejectedValueOnce(new Error('deadlock detected')); // the heal
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // svc-2's correction lands

      const stats = await service.reconcile();

      expect(stats).toMatchObject({ checked: 2, healed: 0, corrected: 1, skipped: 1 });
      expect(mockQuery.mock.calls[2][1]).toEqual(['stopped', 'svc-2', 'machine-2']);
    });
  });

  describe('buildAndDeploy', () => {
    function serviceRow() {
      return {
        id: 'svc-b1',
        project_id: 'proj-123',
        name: 'api',
        image_url: 'old:tag',
        port: 8080,
        cpu: 'shared-1x',
        memory: 256,
        region: 'local',
        provider: 'fly',
        provider_app_id: 'app-1',
        provider_instance_id: 'inst-1',
        status: 'deploying',
        ingress: 'host',
      };
    }

    // A driver whose source builds run on the caller's machine (flyctl) must not
    // silently accept a context upload it will never build.
    it('refuses a context upload on a driver that builds through flyctl', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [serviceRow()] });

      await expect(service.buildAndDeploy('svc-b1', Buffer.from('tar-bytes'))).rejects.toThrow(
        /does not build uploaded contexts/
      );
    });

    it('builds, deploys the resulting tag, and prunes superseded images', async () => {
      mockFlyInstance.capabilities = {
        ...mockFlyInstance.capabilities,
        sourceBuild: 'context-upload',
      };
      const build = vi
        .fn()
        .mockResolvedValue({ imageTag: 'insforge-x/api:abc', logs: ['Step 1/2'] });
      const prune = vi.fn().mockResolvedValue({ removed: 1 });
      (mockFlyInstance as Record<string, unknown>).buildFromContext = build;
      (mockFlyInstance as Record<string, unknown>).pruneServiceImages = prune;

      mockQuery.mockResolvedValueOnce({ rows: [serviceRow()] }); // getService in buildAndDeploy
      mockQuery.mockResolvedValueOnce({ rows: [serviceRow()] }); // getService in updateService
      mockQuery.mockResolvedValueOnce({ rows: [{ env_vars_encrypted: null }] });
      mockUpdateMachine.mockResolvedValue({});
      mockQuery.mockResolvedValueOnce({
        rows: [{ ...serviceRow(), image_url: 'insforge-x/api:abc' }],
      });

      const result = await service.buildAndDeploy('svc-b1', Buffer.from('tar-bytes'), {
        dockerfile: 'Dockerfile.prod',
      });

      expect(build).toHaveBeenCalledWith(
        expect.objectContaining({ serviceName: 'api', dockerfile: 'Dockerfile.prod' })
      );
      expect(result.imageTag).toBe('insforge-x/api:abc');
      // Deployment goes through updateService, so the tested recreate/instance-id
      // bookkeeping applies rather than a second copy of it.
      expect(mockUpdateMachine.mock.calls[0][0].image).toBe('insforge-x/api:abc');
      expect(prune).toHaveBeenCalledWith('api');

      delete (mockFlyInstance as Record<string, unknown>).buildFromContext;
      delete (mockFlyInstance as Record<string, unknown>).pruneServiceImages;
    });

    // A failed build must leave the previous image serving, and must say why.
    it('surfaces the builder error and does not deploy anything', async () => {
      mockFlyInstance.capabilities = {
        ...mockFlyInstance.capabilities,
        sourceBuild: 'context-upload',
      };
      (mockFlyInstance as Record<string, unknown>).buildFromContext = vi
        .fn()
        .mockRejectedValue(new Error('process "/bin/sh -c exit 7" did not complete successfully'));

      mockQuery.mockResolvedValueOnce({ rows: [serviceRow()] });
      mockQuery.mockResolvedValueOnce({ rows: [] }); // status -> failed

      await expect(service.buildAndDeploy('svc-b1', Buffer.from('t'))).rejects.toThrow(/exit 7/);
      expect(mockUpdateMachine).not.toHaveBeenCalled();

      delete (mockFlyInstance as Record<string, unknown>).buildFromContext;
    });

    // The build already wrote an image to disk before the deploy ran, and nothing
    // else removes service images — so a deploy failure that skipped the prune let
    // repeated failures pile up without bound.
    it('still prunes when the build succeeded but the deploy failed', async () => {
      mockFlyInstance.capabilities = {
        ...mockFlyInstance.capabilities,
        sourceBuild: 'context-upload',
      };
      const prune = vi.fn().mockResolvedValue({ removed: 1 });
      (mockFlyInstance as Record<string, unknown>).buildFromContext = vi
        .fn()
        .mockResolvedValue({ imageTag: 'insforge-x/api:abc', logs: [] });
      (mockFlyInstance as Record<string, unknown>).pruneServiceImages = prune;

      mockQuery.mockResolvedValueOnce({ rows: [serviceRow()] }); // getService in buildAndDeploy
      mockQuery.mockResolvedValueOnce({ rows: [serviceRow()] }); // getService in updateService
      mockQuery.mockResolvedValueOnce({ rows: [{ env_vars_encrypted: null }] });
      mockUpdateMachine.mockRejectedValue(new Error('daemon refused to start the container'));

      await expect(service.buildAndDeploy('svc-b1', Buffer.from('t'))).rejects.toThrow();
      expect(prune).toHaveBeenCalledWith('api');

      delete (mockFlyInstance as Record<string, unknown>).buildFromContext;
      delete (mockFlyInstance as Record<string, unknown>).pruneServiceImages;
    });
  });

  describe('createService', () => {
    const input = {
      projectId: 'proj-123',
      name: 'my-api',
      imageUrl: 'docker.io/myapp:latest',
      port: 8080,
      cpu: 'shared-1x' as const,
      memory: 256,
      region: 'iad',
      envVars: { NODE_ENV: 'production' },
    };

    it('inserts into DB, calls createApp + launchMachine, updates status to running', async () => {
      const serviceId = 'svc-uuid-1';

      // INSERT returns the new row
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: serviceId,
            project_id: input.projectId,
            name: input.name,
            image_url: input.imageUrl,
            port: input.port,
            cpu: input.cpu,
            memory: input.memory,
            region: input.region,
            provider_app_id: null,
            provider_instance_id: null,
            status: 'creating',
            endpoint_url: null,
            env_vars_encrypted: null,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
      });

      mockCreateApp.mockResolvedValue({ appId: 'my-api-proj-123' });
      mockLaunchMachine.mockResolvedValue({ machineId: 'machine-abc' });

      // UPDATE after deploy
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: serviceId,
            project_id: input.projectId,
            name: input.name,
            image_url: input.imageUrl,
            port: input.port,
            cpu: input.cpu,
            memory: input.memory,
            region: input.region,
            provider_app_id: 'my-api-proj-123',
            provider_instance_id: 'machine-abc',
            status: 'running',
            endpoint_url: 'https://my-api-proj-123.fly.dev',
            env_vars_encrypted: null,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
      });

      const result = await service.createService(input);

      // Verify INSERT was called
      expect(mockQuery).toHaveBeenCalledTimes(2);
      const insertCall = mockQuery.mock.calls[0];
      expect(insertCall[0]).toContain('INSERT INTO compute.services');
      expect(insertCall[1]).toContain(input.projectId);
      expect(insertCall[1]).toContain(input.name);

      // Verify Fly calls
      expect(mockCreateApp).toHaveBeenCalledWith({ name: 'my-api-proj-123' });
      expect(mockLaunchMachine).toHaveBeenCalledWith(
        expect.objectContaining({
          appId: 'my-api-proj-123',
          image: input.imageUrl,
          port: input.port,
          cpu: input.cpu,
          memory: input.memory,
          region: input.region,
        })
      );

      // Verify status update
      const updateCall = mockQuery.mock.calls[1];
      expect(updateCall[0]).toContain('UPDATE compute.services');
      expect(updateCall[1]).toContain('running');

      // Verify returned shape is camelCase
      expect(result.id).toBe(serviceId);
      expect(result.projectId).toBe(input.projectId);
      expect(result.status).toBe('running');
      expect(result.flyAppId).toBe('my-api-proj-123');
      expect(result.flyMachineId).toBe('machine-abc');
      expect(result.endpointUrl).toBe('https://my-api-proj-123.fly.dev');
    });

    it('throws COMPUTE_SERVICE_NOT_CONFIGURED when provider is not configured', async () => {
      mockIsConfigured.mockReturnValue(false);

      await expect(service.createService(input)).rejects.toThrow(
        'Compute services are not enabled on this project.'
      );
    });

    it('sets status to failed when Fly deploy fails', async () => {
      const serviceId = 'svc-uuid-2';

      // INSERT
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: serviceId,
            project_id: input.projectId,
            name: input.name,
            image_url: input.imageUrl,
            port: input.port,
            cpu: input.cpu,
            memory: input.memory,
            region: input.region,
            provider_app_id: null,
            provider_instance_id: null,
            status: 'creating',
            endpoint_url: null,
            env_vars_encrypted: null,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
      });

      mockCreateApp.mockRejectedValue(new Error('Fly API error'));

      // UPDATE to failed status
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await expect(service.createService(input)).rejects.toThrow();

      // Verify status was set to 'failed'
      const failedUpdateCall = mockQuery.mock.calls[1];
      expect(failedUpdateCall[0]).toContain('UPDATE compute.services');
      expect(failedUpdateCall[1]).toContain('failed');
    });

    // INS-271: end-to-end pass-through of `protocol: 'tcp'` from createService
    // input → INSERT column list → launchMachine params. The cloud-backend +
    // CLI work is wasted if the OSS strips this field. Pin both wire surfaces.
    it('forwards protocol: tcp to INSERT and launchMachine when supplied', async () => {
      const serviceId = 'svc-tcp-create';
      const tcpInput = { ...input, protocol: 'tcp' as const, port: 6379, name: 'my-redis' };

      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: serviceId,
            project_id: tcpInput.projectId,
            name: tcpInput.name,
            image_url: tcpInput.imageUrl,
            port: tcpInput.port,
            cpu: tcpInput.cpu,
            memory: tcpInput.memory,
            region: tcpInput.region,
            protocol: 'tcp',
            provider_app_id: null,
            provider_instance_id: null,
            status: 'creating',
            endpoint_url: null,
            env_vars_encrypted: null,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
      });
      mockCreateApp.mockResolvedValue({ appId: 'my-redis-proj-123' });
      mockLaunchMachine.mockResolvedValue({ machineId: 'mach-tcp' });
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: serviceId,
            project_id: tcpInput.projectId,
            name: tcpInput.name,
            image_url: tcpInput.imageUrl,
            port: tcpInput.port,
            cpu: tcpInput.cpu,
            memory: tcpInput.memory,
            region: tcpInput.region,
            protocol: 'tcp',
            provider_app_id: 'my-redis-proj-123',
            provider_instance_id: 'mach-tcp',
            status: 'running',
            endpoint_url: 'https://my-redis-proj-123.fly.dev',
            env_vars_encrypted: null,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
      });

      const result = await service.createService(tcpInput);

      // INSERT must include the column AND the value (positional bind, so
      // assert the value made it into the params list rather than parsing the
      // SQL string).
      const insertCall = mockQuery.mock.calls[0];
      expect(insertCall[0]).toContain('protocol');
      expect(insertCall[1]).toContain('tcp');

      // launchMachine must receive protocol: 'tcp' so the provider can pick
      // raw-TCP edge handlers instead of HTTP.
      expect(mockLaunchMachine).toHaveBeenCalledWith(expect.objectContaining({ protocol: 'tcp' }));

      // Response shape echoes the persisted value (verified via mapRowToSchema).
      expect(result.protocol).toBe('tcp');
    });

    // Back-compat — omitting protocol must NOT inject 'http' into the
    // launchMachine call as a positive value. Sending `protocol: undefined` is
    // fine (JSON.stringify drops it on the wire); sending `protocol: 'http'`
    // would change the wire format vs pre-INS-271 deploys, which we don't
    // want until we also rev the cloud-backend's wire-format invariant.
    it('omitting protocol does not inject a default value into launchMachine', async () => {
      const serviceId = 'svc-no-proto';

      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: serviceId,
            project_id: input.projectId,
            name: input.name,
            image_url: input.imageUrl,
            port: input.port,
            cpu: input.cpu,
            memory: input.memory,
            region: input.region,
            provider_app_id: null,
            provider_instance_id: null,
            status: 'creating',
            endpoint_url: null,
            env_vars_encrypted: null,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
      });
      mockCreateApp.mockResolvedValue({ appId: 'my-api-proj-123' });
      mockLaunchMachine.mockResolvedValue({ machineId: 'mach-default' });
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: serviceId,
            project_id: input.projectId,
            name: input.name,
            image_url: input.imageUrl,
            port: input.port,
            cpu: input.cpu,
            memory: input.memory,
            region: input.region,
            provider_app_id: 'my-api-proj-123',
            provider_instance_id: 'mach-default',
            status: 'running',
            endpoint_url: 'https://my-api-proj-123.fly.dev',
            env_vars_encrypted: null,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
      });

      await service.createService(input); // input has no `protocol`

      // launchMachine was called; protocol param is undefined (the provider
      // applies its own default). JSON.stringify drops undefined fields, so
      // this preserves the pre-INS-271 wire format byte-for-byte.
      const launchCall = mockLaunchMachine.mock.calls[0][0];
      expect(launchCall.protocol).toBeUndefined();
    });

    // --always-on: end-to-end pass-through of `scaleToZero: false` from
    // createService input → INSERT column list → launchMachine params, same
    // shape as the protocol pass-through above.
    it('forwards scaleToZero: false to INSERT and launchMachine when supplied', async () => {
      const serviceId = 'svc-always-on';
      const alwaysOnInput = { ...input, scaleToZero: false, name: 'my-always-on' };

      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: serviceId,
            project_id: alwaysOnInput.projectId,
            name: alwaysOnInput.name,
            image_url: alwaysOnInput.imageUrl,
            port: alwaysOnInput.port,
            cpu: alwaysOnInput.cpu,
            memory: alwaysOnInput.memory,
            region: alwaysOnInput.region,
            protocol: 'http',
            scale_to_zero: false,
            provider_app_id: null,
            provider_instance_id: null,
            status: 'creating',
            endpoint_url: null,
            env_vars_encrypted: null,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
      });
      mockCreateApp.mockResolvedValue({ appId: 'my-always-on-proj-123' });
      mockLaunchMachine.mockResolvedValue({ machineId: 'mach-always-on' });
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: serviceId,
            project_id: alwaysOnInput.projectId,
            name: alwaysOnInput.name,
            image_url: alwaysOnInput.imageUrl,
            port: alwaysOnInput.port,
            cpu: alwaysOnInput.cpu,
            memory: alwaysOnInput.memory,
            region: alwaysOnInput.region,
            protocol: 'http',
            scale_to_zero: false,
            provider_app_id: 'my-always-on-proj-123',
            provider_instance_id: 'mach-always-on',
            status: 'running',
            endpoint_url: 'https://my-always-on-proj-123.fly.dev',
            env_vars_encrypted: null,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
      });

      const result = await service.createService(alwaysOnInput);

      // INSERT must include the column AND the value (positional bind).
      const insertCall = mockQuery.mock.calls[0];
      expect(insertCall[0]).toContain('scale_to_zero');
      expect(insertCall[1]).toContain(false);

      // launchMachine must receive scaleToZero: false so the provider flips
      // the Fly autostop block to always-on.
      expect(mockLaunchMachine).toHaveBeenCalledWith(
        expect.objectContaining({ scaleToZero: false })
      );

      // Response shape echoes the persisted value (via mapRowToSchema).
      expect(result.scaleToZero).toBe(false);
    });

    // Back-compat — omitting scaleToZero persists the default (true) but must
    // NOT inject a positive value into the launchMachine call; the provider
    // applies its own scale-to-zero default.
    it('omitting scaleToZero persists true and does not inject a value into launchMachine', async () => {
      const serviceId = 'svc-default-stz';

      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: serviceId,
            project_id: input.projectId,
            name: input.name,
            image_url: input.imageUrl,
            port: input.port,
            cpu: input.cpu,
            memory: input.memory,
            region: input.region,
            provider_app_id: null,
            provider_instance_id: null,
            status: 'creating',
            endpoint_url: null,
            env_vars_encrypted: null,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
      });
      mockCreateApp.mockResolvedValue({ appId: 'my-api-proj-123' });
      mockLaunchMachine.mockResolvedValue({ machineId: 'mach-default-stz' });
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: serviceId,
            project_id: input.projectId,
            name: input.name,
            image_url: input.imageUrl,
            port: input.port,
            cpu: input.cpu,
            memory: input.memory,
            region: input.region,
            provider_app_id: 'my-api-proj-123',
            provider_instance_id: 'mach-default-stz',
            status: 'running',
            endpoint_url: 'https://my-api-proj-123.fly.dev',
            env_vars_encrypted: null,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
      });

      await service.createService(input); // input has no `scaleToZero`

      // INSERT falls back to true (`input.scaleToZero ?? true`).
      const insertCall = mockQuery.mock.calls[0];
      expect(insertCall[0]).toContain('scale_to_zero');
      expect(insertCall[1]).toContain(true);

      const launchCall = mockLaunchMachine.mock.calls[0][0];
      expect(launchCall.scaleToZero).toBeUndefined();
    });

    it('passes through structured cloud errors (quota, invalid input, etc.) instead of swallowing as generic 502', async () => {
      // Reproduces the bug found by stress-testing against staging:
      // when the cloud backend returns 403 COMPUTE_QUOTA_EXCEEDED with a clear
      // message ("Project X has reached 5 active services"), the OSS was
      // catching it and re-throwing as generic
      // "Compute service operation failed" 502 — losing the actual reason.
      const { AppError } = await import('@/utils/errors.js');

      const serviceId = 'svc-quota-test';
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: serviceId,
            project_id: input.projectId,
            name: input.name,
            image_url: input.imageUrl,
            port: input.port,
            cpu: input.cpu,
            memory: input.memory,
            region: input.region,
            provider_app_id: null,
            provider_instance_id: null,
            status: 'creating',
            endpoint_url: null,
            env_vars_encrypted: null,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
      });

      // CloudComputeProvider re-wraps the cloud's response body verbatim into
      // an AppError; replicate that shape — JSON string in `message`, status
      // code = HTTP status from cloud.
      const cloudQuotaError = new AppError(
        JSON.stringify({
          code: ERROR_CODES.COMPUTE_QUOTA_EXCEEDED,
          error: 'Project e8a6b768 has reached 5 active services',
        }),
        403,
        ERROR_CODES.COMPUTE_PROVIDER_ERROR
      );
      mockCreateApp.mockRejectedValue(cloudQuotaError);

      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      let thrown: AppError | undefined;
      try {
        await service.createService(input);
      } catch (e) {
        thrown = e as AppError;
      }

      expect(thrown).toBeDefined();
      // Real bug: this used to be 502/COMPUTE_SERVICE_DEPLOY_FAILED. Should be
      // the cloud's actual code + message + status.
      expect(thrown!.statusCode).toBe(403);
      expect(thrown!.code).toBe(ERROR_CODES.COMPUTE_QUOTA_EXCEEDED);
      expect(thrown!.message).toMatch(/has reached 5 active services/);
    });
  });

  describe('listServices', () => {
    it('queries with project_id and returns camelCase rows', async () => {
      const projectId = 'proj-123';
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'svc-1',
            project_id: projectId,
            name: 'app-one',
            image_url: 'img:1',
            port: 8080,
            cpu: 'shared-1x',
            memory: 256,
            region: 'iad',
            provider_app_id: 'app-one-proj-123',
            provider_instance_id: 'machine-1',
            status: 'running',
            endpoint_url: 'https://app-one-proj-123.fly.dev',
            env_vars_encrypted: null,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
      });

      const results = await service.listServices(projectId);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const call = mockQuery.mock.calls[0];
      expect(call[0]).toContain('compute.services');
      expect(call[1]).toEqual([projectId]);

      expect(results).toHaveLength(1);
      expect(results[0].projectId).toBe(projectId);
      expect(results[0].flyAppId).toBe('app-one-proj-123');
    });
  });

  describe('deleteService', () => {
    it('tolerates a cloud 404 (JSON body without a "404" substring) from destroyApp', async () => {
      const serviceId = 'svc-delete-gone';
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: serviceId,
            project_id: 'proj-123',
            name: 'app-gone',
            image_url: 'img:1',
            port: 8080,
            cpu: 'shared-1x',
            memory: 256,
            region: 'iad',
            provider_app_id: 'app-gone-proj-123',
            provider_instance_id: 'machine-gone-1',
            status: 'stopped',
            endpoint_url: 'https://app-gone-proj-123.fly.dev',
            env_vars_encrypted: null,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
      });
      const { AppError: RealAppError } = await import('@/utils/errors.js');
      // Cloud AppError message is the raw JSON body — no '404' substring.
      const cloud404 = new RealAppError(
        '{"code":"COMPUTE_SERVICE_NOT_FOUND","error":"app not found in project"}',
        404,
        ERROR_CODES.COMPUTE_PROVIDER_ERROR
      );
      mockDestroyMachine.mockRejectedValue(cloud404);
      mockDestroyApp.mockRejectedValue(cloud404);
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // destroying UPDATE
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // DELETE

      const snapshot = await service.deleteService(serviceId);

      expect(snapshot.id).toBe(serviceId);
      const deleteCall = mockQuery.mock.calls[mockQuery.mock.calls.length - 1];
      expect(deleteCall[0]).toContain('DELETE FROM compute.services');
    });

    it('marks as destroying, destroys Fly resources, and deletes from DB', async () => {
      const serviceId = 'svc-delete-1';

      // getService query
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: serviceId,
            project_id: 'proj-123',
            name: 'app-del',
            image_url: 'img:1',
            port: 8080,
            cpu: 'shared-1x',
            memory: 256,
            region: 'iad',
            provider_app_id: 'app-del-proj-123',
            provider_instance_id: 'machine-del',
            status: 'running',
            endpoint_url: 'https://app-del-proj-123.fly.dev',
            env_vars_encrypted: null,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
      });

      mockDestroyMachine.mockResolvedValue(undefined);
      mockDestroyApp.mockResolvedValue(undefined);

      // UPDATE (destroying) + DELETE queries
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const snapshot = await service.deleteService(serviceId);

      expect(mockDestroyMachine).toHaveBeenCalledWith('app-del-proj-123', 'machine-del');
      expect(mockDestroyApp).toHaveBeenCalledWith('app-del-proj-123');

      // First DB call after getService is the status update to 'destroying'
      const destroyingCall = mockQuery.mock.calls[1];
      expect(destroyingCall[0]).toContain('destroying');

      // Last DB call is the DELETE
      const deleteCall = mockQuery.mock.calls[mockQuery.mock.calls.length - 1];
      expect(deleteCall[0]).toContain('DELETE FROM compute.services');
      expect(deleteCall[1]).toEqual([serviceId]);

      // Snapshot is enough state to reconstruct the deleted service (used as
      // an audit-log paper trail for accidental deletes).
      expect(snapshot).toEqual({
        id: serviceId,
        projectId: 'proj-123',
        name: 'app-del',
        imageUrl: 'img:1',
        port: 8080,
        cpu: 'shared-1x',
        memory: 256,
        region: 'iad',
        // mapRowToSchema / snapshot path falls back to 'http' when the row is
        // missing the column (pre-INS-271 rows backfilled by the 047
        // migration). The fixture above doesn't set `protocol`, so this is
        // the back-compat default surfacing.
        protocol: 'http',
        // Same back-compat fallback: fixture has no scale_to_zero column, so
        // the snapshot surfaces the default (true).
        scaleToZero: true,
        // Same back-compat fallback again: the fixture predates migration 064, so
        // the snapshot surfaces its documented defaults — 'fly' because that was
        // the only driver, and 'host' because every Fly app is already on a public
        // hostname.
        ingress: 'host',
        provider: 'fly',
        providerAppId: 'app-del-proj-123',
        providerInstanceId: 'machine-del',
        endpointUrl: 'https://app-del-proj-123.fly.dev',
        envVarsEncrypted: null,
        createdAt: '2026-01-01T00:00:00Z',
      });
    });

    it('snapshot passes the env_vars_encrypted ciphertext through verbatim — never decrypts', async () => {
      const serviceId = 'svc-delete-env';
      // Use a deliberately opaque blob with no plaintext substring inside.
      // Production stores AES-GCM ciphertext; the assertion is that the
      // service hands the bytes through to the caller unchanged, never
      // attempting to decrypt them on the delete path.
      const ciphertext = 'AESGCM:opaque-cipher-blob-xyz';

      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: serviceId,
            project_id: 'proj-123',
            name: 'app-env',
            image_url: 'img:1',
            port: 8080,
            cpu: 'shared-1x',
            memory: 256,
            region: 'iad',
            provider_app_id: 'app-env-proj-123',
            provider_instance_id: 'machine-env',
            status: 'running',
            endpoint_url: 'https://app-env-proj-123.fly.dev',
            env_vars_encrypted: ciphertext,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
      });
      mockDestroyMachine.mockResolvedValue(undefined);
      mockDestroyApp.mockResolvedValue(undefined);
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // UPDATE destroying
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // DELETE

      const snapshot = await service.deleteService(serviceId);

      expect(snapshot.envVarsEncrypted).toBe(ciphertext);
    });

    it('marks as failed and throws if Fly destroy fails (preserves DB reference)', async () => {
      const serviceId = 'svc-delete-2';

      // getService query
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: serviceId,
            project_id: 'proj-123',
            name: 'app-del2',
            image_url: 'img:1',
            port: 8080,
            cpu: 'shared-1x',
            memory: 256,
            region: 'iad',
            provider_app_id: 'app-del2-proj-123',
            provider_instance_id: 'machine-del2',
            status: 'running',
            endpoint_url: 'https://app-del2-proj-123.fly.dev',
            env_vars_encrypted: null,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
      });

      mockDestroyMachine.mockRejectedValue(new Error('Fly error'));

      // UPDATE (destroying) + UPDATE (failed) queries
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await expect(service.deleteService(serviceId)).rejects.toThrow(
        'Failed to delete compute service'
      );

      // DB row should be preserved (marked failed, not deleted)
      const failedCall = mockQuery.mock.calls[2];
      expect(failedCall[0]).toContain('failed');
    });
  });

  describe('prepareForDeploy', () => {
    const input = {
      projectId: 'proj-123',
      name: 'my-api',
      imageUrl: 'dockerfile',
      port: 8080,
      cpu: 'shared-1x' as const,
      memory: 512,
      region: 'iad',
    };

    it('inserts DB record with deploying status and creates Fly app (no machine)', async () => {
      const serviceId = 'svc-deploy-1';

      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: serviceId,
            project_id: input.projectId,
            name: input.name,
            image_url: input.imageUrl,
            port: input.port,
            cpu: input.cpu,
            memory: input.memory,
            region: input.region,
            provider_app_id: 'my-api-proj-123',
            provider_instance_id: null,
            status: 'deploying',
            endpoint_url: 'https://my-api-proj-123.fly.dev',
            env_vars_encrypted: null,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
      });

      mockCreateApp.mockResolvedValue({ appId: 'my-api-proj-123' });

      const result = await service.prepareForDeploy(input);

      // Verify INSERT
      const insertCall = mockQuery.mock.calls[0];
      expect(insertCall[0]).toContain('INSERT INTO compute.services');
      expect(insertCall[0]).toContain("'deploying'");
      expect(insertCall[1]).toContain(input.projectId);
      expect(insertCall[1]).toContain('my-api-proj-123'); // flyAppId

      // Verify Fly app created
      expect(mockCreateApp).toHaveBeenCalledWith({ name: 'my-api-proj-123' });

      // Verify NO machine launched
      expect(mockLaunchMachine).not.toHaveBeenCalled();

      // Verify returned shape
      expect(result.id).toBe(serviceId);
      expect(result.status).toBe('deploying');
      expect(result.flyAppId).toBe('my-api-proj-123');
      expect(result.flyMachineId).toBeNull();
      expect(result.endpointUrl).toBe('https://my-api-proj-123.fly.dev');
    });

    it('throws COMPUTE_SERVICE_NOT_CONFIGURED when provider is not configured', async () => {
      mockIsConfigured.mockReturnValue(false);
      await expect(service.prepareForDeploy(input)).rejects.toThrow(
        'Compute services are not enabled on this project.'
      );
    });

    it('ignores 422 error from createApp (app already exists)', async () => {
      const serviceId = 'svc-deploy-2';

      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: serviceId,
            project_id: input.projectId,
            name: input.name,
            image_url: input.imageUrl,
            port: input.port,
            cpu: input.cpu,
            memory: input.memory,
            region: input.region,
            provider_app_id: 'my-api-proj-123',
            provider_instance_id: null,
            status: 'deploying',
            endpoint_url: 'https://my-api-proj-123.fly.dev',
            env_vars_encrypted: null,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
      });

      mockCreateApp.mockRejectedValue(new Error('Fly API error (422): app already exists'));

      const result = await service.prepareForDeploy(input);

      expect(result.id).toBe(serviceId);
      expect(result.status).toBe('deploying');
    });

    it('cleans up DB record and rethrows on non-422 Fly error', async () => {
      const serviceId = 'svc-deploy-3';

      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: serviceId,
            project_id: input.projectId,
            name: input.name,
            image_url: input.imageUrl,
            port: input.port,
            cpu: input.cpu,
            memory: input.memory,
            region: input.region,
            provider_app_id: 'my-api-proj-123',
            provider_instance_id: null,
            status: 'deploying',
            endpoint_url: 'https://my-api-proj-123.fly.dev',
            env_vars_encrypted: null,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
      });

      mockCreateApp.mockRejectedValue(new Error('Fly API error (500): internal error'));
      mockDestroyApp.mockResolvedValue(undefined);

      // DELETE cleanup
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await expect(service.prepareForDeploy(input)).rejects.toThrow('Fly API error (500)');

      // Verify Fly-side cleanup so the partially-created app doesn't leak
      // (regression: previously only the DB row was deleted, leaving the
      // Fly app orphaned in our org).
      expect(mockDestroyApp).toHaveBeenCalledWith('my-api-proj-123');

      // Verify cleanup DELETE
      const deleteCall = mockQuery.mock.calls[1];
      expect(deleteCall[0]).toContain('DELETE FROM compute.services');
      expect(deleteCall[1]).toEqual([serviceId]);
    });

    it('still rethrows the original Fly error if destroyApp cleanup itself fails', async () => {
      const serviceId = 'svc-deploy-4';

      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: serviceId,
            project_id: input.projectId,
            name: input.name,
            image_url: input.imageUrl,
            port: input.port,
            cpu: input.cpu,
            memory: input.memory,
            region: input.region,
            provider_app_id: 'my-api-proj-123',
            provider_instance_id: null,
            status: 'deploying',
            endpoint_url: 'https://my-api-proj-123.fly.dev',
            env_vars_encrypted: null,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
      });

      mockCreateApp.mockRejectedValue(new Error('Fly API error (500): IP allocation failed'));
      mockDestroyApp.mockRejectedValue(new Error('Fly API error (502): bad gateway'));

      // DELETE cleanup still runs despite destroyApp failure.
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await expect(service.prepareForDeploy(input)).rejects.toThrow(/IP allocation failed/);

      // destroyApp was attempted (best effort).
      expect(mockDestroyApp).toHaveBeenCalledWith('my-api-proj-123');
      // DB row still cleaned up.
      const deleteCall = mockQuery.mock.calls[1];
      expect(deleteCall[0]).toContain('DELETE FROM compute.services');
    });
  });

  describe('Fly app name length guard', () => {
    it('throws when projectId is too long to fit in a Fly app name', async () => {
      const longProjectId = 'a'.repeat(60);
      await expect(
        service.prepareForDeploy({
          projectId: longProjectId,
          name: 'api',
          imageUrl: 'nginx:latest',
          port: 8080,
          cpu: 'shared-1x',
          memory: 512,
          region: 'iad',
        })
      ).rejects.toThrow(/projectId is too long/);
    });
  });

  describe('stopService', () => {
    const serviceRow = {
      id: 'svc-stop-1',
      project_id: 'proj-123',
      name: 'my-api',
      image_url: 'nginx:latest',
      port: 8080,
      cpu: 'shared-1x',
      memory: 256,
      region: 'iad',
      provider_app_id: 'my-api-proj-123',
      provider_instance_id: 'machine-1',
      status: 'running',
      endpoint_url: 'https://my-api-proj-123.fly.dev',
      env_vars_encrypted: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    it('stops machine and updates status to stopped', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [serviceRow] }); // getService
      mockStopMachine.mockResolvedValue(undefined);
      mockQuery.mockResolvedValueOnce({ rows: [{ ...serviceRow, status: 'stopped' }] }); // UPDATE

      const result = await service.stopService('svc-stop-1');

      expect(mockStopMachine).toHaveBeenCalledWith('my-api-proj-123', 'machine-1');
      expect(result.status).toBe('stopped');
    });

    it('throws COMPUTE_SERVICE_NOT_FOUND when UPDATE affects zero rows', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [serviceRow] }); // getService
      mockStopMachine.mockResolvedValue(undefined);
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // UPDATE returns nothing

      await expect(service.stopService('svc-stop-1')).rejects.toThrow('Service not found');
    });

    it('throws COMPUTE_SERVICE_STOP_FAILED when stopMachine fails', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [serviceRow] }); // getService
      mockStopMachine.mockRejectedValue(new Error('Fly error'));

      await expect(service.stopService('svc-stop-1')).rejects.toThrow(/Failed to stop/);
    });
  });

  describe('startService', () => {
    const serviceRow = {
      id: 'svc-start-1',
      project_id: 'proj-123',
      name: 'my-api',
      image_url: 'nginx:latest',
      port: 8080,
      cpu: 'shared-1x',
      memory: 256,
      region: 'iad',
      provider_app_id: 'my-api-proj-123',
      provider_instance_id: 'machine-1',
      status: 'stopped',
      endpoint_url: 'https://my-api-proj-123.fly.dev',
      env_vars_encrypted: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    it('starts machine and updates status to running', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [serviceRow] }); // getService
      mockStartMachine.mockResolvedValue(undefined);
      mockQuery.mockResolvedValueOnce({ rows: [{ ...serviceRow, status: 'running' }] }); // UPDATE

      const result = await service.startService('svc-start-1');

      expect(mockStartMachine).toHaveBeenCalledWith('my-api-proj-123', 'machine-1');
      expect(result.status).toBe('running');
    });

    it('throws COMPUTE_SERVICE_NOT_FOUND when UPDATE affects zero rows', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [serviceRow] }); // getService
      mockStartMachine.mockResolvedValue(undefined);
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // UPDATE returns nothing

      await expect(service.startService('svc-start-1')).rejects.toThrow('Service not found');
    });

    it('throws COMPUTE_SERVICE_START_FAILED when startMachine fails', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [serviceRow] }); // getService
      mockStartMachine.mockRejectedValue(new Error('Fly error'));

      await expect(service.startService('svc-start-1')).rejects.toThrow(/Failed to start/);
    });
  });

  // A machine can vanish on the provider while our row still points at it
  // (idle reaping, out-of-band delete). Providers throw MachineGoneError on a
  // definitive 404; the service layer must heal the stale row (fly_machine_id
  // → NULL, status → stopped) and surface a typed COMPUTE_MACHINE_NOT_FOUND
  // 404 instead of an opaque 5xx forever.
  describe('machine-gone healing', () => {
    const serviceRow = {
      id: 'svc-ghost-1',
      project_id: 'proj-123',
      name: 'my-api',
      image_url: 'nginx:latest',
      port: 8080,
      cpu: 'shared-1x',
      memory: 256,
      region: 'iad',
      provider_app_id: 'my-api-proj-123',
      provider_instance_id: 'machine-ghost',
      status: 'running',
      endpoint_url: 'https://my-api-proj-123.fly.dev',
      env_vars_encrypted: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
    const gone = () => new MachineGoneError('my-api-proj-123', 'machine-ghost');

    function expectHealQuery() {
      const healCall = mockQuery.mock.calls.find(
        ([sql]) => typeof sql === 'string' && sql.includes('provider_instance_id = NULL')
      );
      expect(healCall).toBeDefined();
      expect(healCall?.[1]).toEqual(['svc-ghost-1', 'machine-ghost']);
    }

    it('getServiceEvents heals the row and throws COMPUTE_MACHINE_NOT_FOUND', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [serviceRow] }); // getService
      mockGetEvents.mockRejectedValue(gone());
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // heal UPDATE

      await expect(service.getServiceEvents('svc-ghost-1')).rejects.toMatchObject({
        statusCode: 404,
        code: ERROR_CODES.COMPUTE_MACHINE_NOT_FOUND,
      });
      expectHealQuery();
    });

    it('getServiceLogs heals the row and throws COMPUTE_MACHINE_NOT_FOUND', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [serviceRow] }); // getService
      mockGetLogs.mockRejectedValue(gone());
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // heal UPDATE

      await expect(service.getServiceLogs('svc-ghost-1')).rejects.toMatchObject({
        statusCode: 404,
        code: ERROR_CODES.COMPUTE_MACHINE_NOT_FOUND,
      });
      expectHealQuery();
    });

    it('startService heals the row and throws COMPUTE_MACHINE_NOT_FOUND', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [serviceRow] }); // getService
      mockStartMachine.mockRejectedValue(gone());
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // heal UPDATE

      await expect(service.startService('svc-ghost-1')).rejects.toMatchObject({
        statusCode: 404,
        code: ERROR_CODES.COMPUTE_MACHINE_NOT_FOUND,
      });
      expectHealQuery();
    });

    it('stopService on a gone machine succeeds — desired state already true', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [serviceRow] }); // getService
      mockStopMachine.mockRejectedValue(gone());
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // heal UPDATE
      mockQuery.mockResolvedValueOnce({
        rows: [{ ...serviceRow, provider_instance_id: null, status: 'stopped' }],
      }); // status UPDATE

      const result = await service.stopService('svc-ghost-1');

      expect(result.status).toBe('stopped');
      expectHealQuery();
    });

    it('post-heal requests get COMPUTE_MACHINE_NOT_FOUND + redeploy guidance, not "Service not found"', async () => {
      const healedRow = { ...serviceRow, provider_instance_id: null, status: 'stopped' };
      const calls = [
        () => service.getServiceEvents('svc-ghost-1'),
        () => service.getServiceLogs('svc-ghost-1'),
        () => service.startService('svc-ghost-1'),
        () => service.stopService('svc-ghost-1'),
      ];
      for (const call of calls) {
        mockQuery.mockResolvedValueOnce({ rows: [healedRow] }); // getService
        await expect(call()).rejects.toMatchObject({
          statusCode: 404,
          code: ERROR_CODES.COMPUTE_MACHINE_NOT_FOUND,
        });
      }
    });

    it('updateService relaunches the stored image when a deploy-field PATCH hits a healed row', async () => {
      const healedRow = { ...serviceRow, provider_instance_id: null, status: 'stopped' };
      mockQuery.mockResolvedValueOnce({ rows: [healedRow] }); // getService
      mockQuery.mockResolvedValueOnce({ rows: [{ env_vars_encrypted: null }] }); // hoisted SELECT
      mockLaunchMachine.mockResolvedValue({ machineId: 'mach-fresh' });
      mockQuery.mockResolvedValueOnce({
        rows: [{ ...healedRow, provider_instance_id: 'mach-fresh', status: 'running' }],
      }); // final UPDATE

      const result = await service.updateService('svc-ghost-1', {
        envVars: { NEW: 'value' },
      });

      expect(mockLaunchMachine).toHaveBeenCalledWith(
        expect.objectContaining({
          appId: 'my-api-proj-123',
          image: 'nginx:latest', // the stored image, relaunched
        })
      );
      expect(result.flyMachineId).toBe('mach-fresh');
    });

    it('updateService does NOT relaunch during the prepare-window (placeholder image)', async () => {
      // prepareForDeploy rows: status deploying, image_url is a placeholder.
      const prepareRow = {
        ...serviceRow,
        provider_instance_id: null,
        status: 'deploying',
        image_url: 'dockerfile',
      };
      mockQuery.mockResolvedValueOnce({ rows: [prepareRow] }); // getService
      mockQuery.mockResolvedValueOnce({ rows: [{ env_vars_encrypted: null }] }); // hoisted SELECT
      mockQuery.mockResolvedValueOnce({ rows: [prepareRow] }); // final UPDATE

      await service.updateService('svc-ghost-1', { envVars: { NEW: 'value' } });

      expect(mockLaunchMachine).not.toHaveBeenCalled();
      expect(mockUpdateMachine).not.toHaveBeenCalled();
    });

    it('transient provider errors do NOT heal the row', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [serviceRow] }); // getService
      mockGetEvents.mockRejectedValue(new Error('Fly API error (500): internal'));

      await expect(service.getServiceEvents('svc-ghost-1')).rejects.toThrow(/500/);
      const healCall = mockQuery.mock.calls.find(
        ([sql]) => typeof sql === 'string' && sql.includes('provider_instance_id = NULL')
      );
      expect(healCall).toBeUndefined();
    });
  });

  describe('updateService — Path A first-launch branch', () => {
    // Service that prepareForDeploy has already created: app exists, but no
    // machine yet. The CLI now PATCHes with an imageUrl (it just built+pushed)
    // and we must launch the machine.
    const baseRow = {
      id: 'svc-pa-1',
      project_id: 'proj-123',
      name: 'my-api',
      image_url: 'dockerfile',
      port: 8080,
      cpu: 'shared-1x',
      memory: 512,
      region: 'iad',
      provider_app_id: 'my-api-proj-123',
      provider_instance_id: null,
      status: 'deploying',
      endpoint_url: 'https://my-api-proj-123.fly.dev',
      env_vars_encrypted: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    it('happy path: launches machine, persists machineId/status/endpoint', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [baseRow] }); // getService
      mockQuery.mockResolvedValueOnce({ rows: [{ env_vars_encrypted: null }] }); // hoisted SELECT
      mockLaunchMachine.mockResolvedValue({ machineId: 'mach-pa-1' });
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            ...baseRow,
            provider_instance_id: 'mach-pa-1',
            status: 'running',
            endpoint_url: 'https://my-api-proj-123.fly.dev',
            image_url: 'registry.fly.io/my-api-proj-123:deployment-abc',
          },
        ],
      }); // final UPDATE (with optimistic lock)

      const result = await service.updateService('svc-pa-1', {
        imageUrl: 'registry.fly.io/my-api-proj-123:deployment-abc',
      });

      // launchMachine called with the existing app id + the new image
      expect(mockLaunchMachine).toHaveBeenCalledWith(
        expect.objectContaining({
          appId: 'my-api-proj-123',
          image: 'registry.fly.io/my-api-proj-123:deployment-abc',
          port: 8080,
          cpu: 'shared-1x',
          memory: 512,
          region: 'iad',
        })
      );
      // updateMachine MUST NOT be called on the first-launch path
      expect(mockUpdateMachine).not.toHaveBeenCalled();

      // The final UPDATE carries the optimistic lock.
      const updateCall = mockQuery.mock.calls[2];
      expect(updateCall[0]).toContain('UPDATE compute.services');
      expect(updateCall[0]).toContain('provider_instance_id IS NULL');
      expect(updateCall[1]).toContain('mach-pa-1');
      expect(updateCall[1]).toContain('running');

      expect(result.flyMachineId).toBe('mach-pa-1');
      expect(result.status).toBe('running');
      expect(result.endpointUrl).toBe('https://my-api-proj-123.fly.dev');
    });

    it('rewraps structured cloud errors (quota / nextActions surfaces through)', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [baseRow] }); // getService
      mockQuery.mockResolvedValueOnce({ rows: [{ env_vars_encrypted: null }] }); // hoisted SELECT

      // CloudComputeProvider wraps the cloud's JSON body verbatim into an
      // AppError whose .message is the raw body. The catch block must parse
      // it back out and surface code/message/nextActions.
      const { AppError } = await import('@/utils/errors.js');
      const cloudBody = JSON.stringify({
        code: ERROR_CODES.COMPUTE_QUOTA_EXCEEDED,
        error: 'Project compute quota exceeded',
        nextActions: ['upgrade plan', 'delete unused services'],
      });
      mockLaunchMachine.mockRejectedValue(
        new AppError(cloudBody, 403, ERROR_CODES.COMPUTE_QUOTA_EXCEEDED)
      );

      await expect(
        service.updateService('svc-pa-1', { imageUrl: 'registry.fly.io/x:y' })
      ).rejects.toMatchObject({
        statusCode: 403,
        code: ERROR_CODES.COMPUTE_QUOTA_EXCEEDED,
        message: 'Project compute quota exceeded',
      });

      // Final UPDATE must NOT have run — Fly call failed.
      expect(mockQuery.mock.calls.some((c) => String(c[0]).startsWith('UPDATE'))).toBe(false);
    });

    // INS-271: updateService forwards protocol through to updateMachine on
    // the redeploy path. Switching http<->tcp swaps the Fly edge handlers
    // entirely, so the provider has to know.
    it('forwards protocol: tcp to updateMachine on redeploy', async () => {
      const deployedRow = {
        ...baseRow,
        provider_instance_id: 'mach-existing',
        status: 'running',
        protocol: 'http',
      };
      mockQuery.mockResolvedValueOnce({ rows: [deployedRow] }); // getService
      mockQuery.mockResolvedValueOnce({ rows: [{ env_vars_encrypted: null }] }); // hoisted SELECT
      mockUpdateMachine.mockResolvedValue(undefined);
      mockQuery.mockResolvedValueOnce({
        rows: [{ ...deployedRow, protocol: 'tcp' }],
      });

      await service.updateService('svc-pa-1', { protocol: 'tcp' });

      expect(mockUpdateMachine).toHaveBeenCalledWith(
        expect.objectContaining({
          appId: 'my-api-proj-123',
          machineId: 'mach-existing',
          protocol: 'tcp',
        })
      );

      // SQL UPDATE persists the new protocol value.
      const updateCall = mockQuery.mock.calls[2];
      expect(updateCall[0]).toContain('protocol');
      expect(updateCall[1]).toContain('tcp');
    });

    // Docker cannot change an image in place, so it replaces the container. The
    // replacement comes up running, and a row that was 'stopped' (the caller had
    // stopped the service, then redeployed it) would otherwise keep claiming
    // 'stopped' while the container runs.
    it('flips a stopped row to running when the driver replaced the instance', async () => {
      const stoppedRow = {
        ...baseRow,
        provider_instance_id: 'mach-old',
        status: 'stopped',
      };
      mockQuery.mockResolvedValueOnce({ rows: [stoppedRow] }); // getService
      mockQuery.mockResolvedValueOnce({ rows: [{ env_vars_encrypted: null }] }); // hoisted SELECT
      mockUpdateMachine.mockResolvedValue({ machineId: 'mach-new', endpointUrl: null });
      mockQuery.mockResolvedValueOnce({ rows: [{ ...stoppedRow, status: 'running' }] });

      await service.updateService('svc-pa-1', { imageUrl: 'nginx:1.27' });

      const [sql, params] = mockQuery.mock.calls[2];
      expect(sql).toContain('status');
      expect(params).toContain('running');
      expect(params).toContain('mach-new');
    });

    // The provider contract does not tie `endpointUrl` to a replacement: a driver
    // that re-publishes a port on the same instance (ingress none -> port) reports
    // a fresh URL with no new id, and nesting the write under the id check dropped
    // it.
    it('persists a new endpointUrl even when the instance was not replaced', async () => {
      const deployedRow = { ...baseRow, provider_instance_id: 'mach-existing', status: 'running' };
      mockQuery.mockResolvedValueOnce({ rows: [deployedRow] });
      mockQuery.mockResolvedValueOnce({ rows: [{ env_vars_encrypted: null }] });
      mockUpdateMachine.mockResolvedValue({ endpointUrl: 'http://127.0.0.1:32770' });
      mockQuery.mockResolvedValueOnce({ rows: [deployedRow] });

      await service.updateService('svc-pa-1', { ingress: 'port' });

      const [sql, params] = mockQuery.mock.calls[2];
      expect(sql).toContain('endpoint_url');
      expect(params).toContain('http://127.0.0.1:32770');
      // No replacement happened, so the stored instance id must not be touched.
      expect(sql).not.toContain('provider_instance_id');
    });

    // The mirror image: an in-place update starts nothing, so a stopped service
    // that only resizes stays stopped.
    it('leaves a stopped row stopped when the driver updated in place', async () => {
      const stoppedRow = {
        ...baseRow,
        provider_instance_id: 'mach-existing',
        status: 'stopped',
      };
      mockQuery.mockResolvedValueOnce({ rows: [stoppedRow] });
      mockQuery.mockResolvedValueOnce({ rows: [{ env_vars_encrypted: null }] });
      mockUpdateMachine.mockResolvedValue({}); // same instance, resized in place
      mockQuery.mockResolvedValueOnce({ rows: [stoppedRow] });

      await service.updateService('svc-pa-1', { memory: 1024 });

      const [sql, params] = mockQuery.mock.calls[2];
      expect(sql).not.toContain('status');
      expect(params).not.toContain('running');
    });

    // Back-compat — if the caller doesn't pass `protocol`, the persisted value
    // (from `existing.protocol`) flows through. This is how a port-only update
    // keeps the existing service's protocol setting.
    it('preserves existing.protocol when update omits the field', async () => {
      const deployedRow = {
        ...baseRow,
        provider_instance_id: 'mach-existing',
        status: 'running',
        protocol: 'tcp',
      };
      mockQuery.mockResolvedValueOnce({ rows: [deployedRow] }); // getService
      mockQuery.mockResolvedValueOnce({ rows: [{ env_vars_encrypted: null }] }); // hoisted SELECT
      mockUpdateMachine.mockResolvedValue(undefined);
      mockQuery.mockResolvedValueOnce({ rows: [deployedRow] });

      // Memory-only update — should still forward the existing tcp protocol.
      await service.updateService('svc-pa-1', { memory: 1024 });

      expect(mockUpdateMachine).toHaveBeenCalledWith(expect.objectContaining({ protocol: 'tcp' }));
    });

    // --always-on: updateService forwards scaleToZero through to updateMachine
    // on the redeploy path so an existing service can be flipped to always-on
    // (or back) without delete + redeploy.
    it('forwards scaleToZero: false to updateMachine on redeploy', async () => {
      const deployedRow = {
        ...baseRow,
        provider_instance_id: 'mach-existing',
        status: 'running',
        scale_to_zero: true,
      };
      mockQuery.mockResolvedValueOnce({ rows: [deployedRow] }); // getService
      mockQuery.mockResolvedValueOnce({ rows: [{ env_vars_encrypted: null }] }); // hoisted SELECT
      mockUpdateMachine.mockResolvedValue(undefined);
      mockQuery.mockResolvedValueOnce({
        rows: [{ ...deployedRow, scale_to_zero: false }],
      });

      const result = await service.updateService('svc-pa-1', { scaleToZero: false });

      expect(mockUpdateMachine).toHaveBeenCalledWith(
        expect.objectContaining({
          appId: 'my-api-proj-123',
          machineId: 'mach-existing',
          scaleToZero: false,
        })
      );

      // SQL UPDATE persists the new value.
      const updateCall = mockQuery.mock.calls[2];
      expect(updateCall[0]).toContain('scale_to_zero');
      expect(updateCall[1]).toContain(false);
      expect(result.scaleToZero).toBe(false);
    });

    // Back-compat — a field-only update keeps the persisted always-on setting
    // flowing to Fly (`data.scaleToZero ?? existing.scaleToZero`), so a plain
    // redeploy doesn't silently flip an always-on service back to scale-to-zero.
    it('preserves existing scaleToZero: false when update omits the field', async () => {
      const deployedRow = {
        ...baseRow,
        provider_instance_id: 'mach-existing',
        status: 'running',
        scale_to_zero: false,
      };
      mockQuery.mockResolvedValueOnce({ rows: [deployedRow] }); // getService
      mockQuery.mockResolvedValueOnce({ rows: [{ env_vars_encrypted: null }] }); // hoisted SELECT
      mockUpdateMachine.mockResolvedValue(undefined);
      mockQuery.mockResolvedValueOnce({ rows: [deployedRow] });

      await service.updateService('svc-pa-1', { memory: 1024 });

      expect(mockUpdateMachine).toHaveBeenCalledWith(
        expect.objectContaining({ scaleToZero: false })
      );
    });

    it('regression: existing machine + imageUrl takes the redeploy path (updateMachine, no launch, no optimistic lock)', async () => {
      const deployedRow = { ...baseRow, provider_instance_id: 'mach-existing', status: 'running' };
      mockQuery.mockResolvedValueOnce({ rows: [deployedRow] }); // getService
      mockQuery.mockResolvedValueOnce({ rows: [{ env_vars_encrypted: null }] }); // hoisted SELECT
      mockUpdateMachine.mockResolvedValue(undefined);
      mockQuery.mockResolvedValueOnce({
        rows: [{ ...deployedRow, image_url: 'registry.fly.io/my-api:v2' }],
      }); // final UPDATE (no optimistic lock)

      await service.updateService('svc-pa-1', { imageUrl: 'registry.fly.io/my-api:v2' });

      expect(mockUpdateMachine).toHaveBeenCalledWith(
        expect.objectContaining({
          appId: 'my-api-proj-123',
          machineId: 'mach-existing',
          image: 'registry.fly.io/my-api:v2',
        })
      );
      expect(mockLaunchMachine).not.toHaveBeenCalled();

      const updateCall = mockQuery.mock.calls[2];
      expect(updateCall[0]).toContain('UPDATE compute.services');
      // No optimistic lock on the redeploy path — only first-launch needs it.
      expect(updateCall[0]).not.toContain('provider_instance_id IS NULL');
    });

    it('race condition: concurrent launch loses DB write, destroys orphan, returns winning state', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [baseRow] }); // getService
      mockQuery.mockResolvedValueOnce({ rows: [{ env_vars_encrypted: null }] }); // hoisted SELECT
      mockLaunchMachine.mockResolvedValue({ machineId: 'mach-loser' });
      // Final UPDATE returns 0 rows — the other concurrent request already
      // wrote fly_machine_id, and `AND fly_machine_id IS NULL` filtered us out.
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      mockDestroyMachine.mockResolvedValue(undefined);
      // Cleanup path: getService returns the winning state.
      const winningRow = { ...baseRow, provider_instance_id: 'mach-winner', status: 'running' };
      mockQuery.mockResolvedValueOnce({ rows: [winningRow] }); // final getService

      const result = await service.updateService('svc-pa-1', {
        imageUrl: 'registry.fly.io/my-api-proj-123:deployment-abc',
      });

      // We MUST destroy the machine we just created so it doesn't keep billing.
      expect(mockDestroyMachine).toHaveBeenCalledWith('my-api-proj-123', 'mach-loser');
      // Caller sees the WINNING state, not an error — both requests "succeed"
      // from the user's POV (idempotent retry).
      expect(result.flyMachineId).toBe('mach-winner');
      expect(result.status).toBe('running');
    });

    it('race condition: even if cleanup destroyMachine fails, still returns winning state (best-effort)', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [baseRow] }); // getService
      mockQuery.mockResolvedValueOnce({ rows: [{ env_vars_encrypted: null }] }); // hoisted SELECT
      mockLaunchMachine.mockResolvedValue({ machineId: 'mach-loser' });
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // optimistic lock filters us out
      mockDestroyMachine.mockRejectedValue(new Error('Fly transient 503'));
      const winningRow = { ...baseRow, provider_instance_id: 'mach-winner', status: 'running' };
      mockQuery.mockResolvedValueOnce({ rows: [winningRow] }); // final getService

      const result = await service.updateService('svc-pa-1', {
        imageUrl: 'registry.fly.io/x:y',
      });

      expect(mockDestroyMachine).toHaveBeenCalled();
      expect(result.flyMachineId).toBe('mach-winner');
    });
  });

  describe('updateService — envVarsPatch (partial env edit)', () => {
    const SERVICE_ID = 'svc-patch-1';
    const baseRow = {
      id: SERVICE_ID,
      project_id: 'proj-1',
      name: 'patch-svc',
      image_url: 'img:1',
      port: 8080,
      cpu: 'shared-1x',
      memory: 256,
      region: 'iad',
      provider_app_id: 'patch-svc-proj-1',
      provider_instance_id: 'mach-1',
      status: 'running',
      endpoint_url: 'https://patch-svc-proj-1.fly.dev',
      env_vars_encrypted: `encrypted:${JSON.stringify({ KEEP: 'k', ROTATE_ME: 'old' })}`,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    it('merges set keys with existing env, preserves untouched keys', async () => {
      // 1. getService initial fetch
      mockQuery.mockResolvedValueOnce({ rows: [baseRow] });
      // 2. SELECT env_vars_encrypted for the patch resolution
      mockQuery.mockResolvedValueOnce({
        rows: [{ env_vars_encrypted: baseRow.env_vars_encrypted }],
      });
      // 3. SELECT env_vars_encrypted for the Fly redeploy merge
      mockQuery.mockResolvedValueOnce({
        rows: [{ env_vars_encrypted: baseRow.env_vars_encrypted }],
      });
      mockUpdateMachine.mockResolvedValue(undefined);
      // 4. final UPDATE returning the persisted row
      mockQuery.mockResolvedValueOnce({ rows: [baseRow] });

      await service.updateService(SERVICE_ID, {
        envVarsPatch: { set: { ROTATE_ME: 'new', NEW_KEY: 'added' } },
      });

      // Verify Fly received the merged env: KEEP preserved, ROTATE_ME updated,
      // NEW_KEY added. None of these would be visible to the caller via the
      // public API (envVars is never returned), so this assertion is the
      // contract that secret rotation actually works.
      expect(mockUpdateMachine).toHaveBeenCalledWith(
        expect.objectContaining({
          envVars: { KEEP: 'k', ROTATE_ME: 'new', NEW_KEY: 'added' },
        })
      );
    });

    it('removes unset keys while preserving the rest', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [baseRow] });
      mockQuery.mockResolvedValueOnce({
        rows: [{ env_vars_encrypted: baseRow.env_vars_encrypted }],
      });
      mockQuery.mockResolvedValueOnce({
        rows: [{ env_vars_encrypted: baseRow.env_vars_encrypted }],
      });
      mockUpdateMachine.mockResolvedValue(undefined);
      mockQuery.mockResolvedValueOnce({ rows: [baseRow] });

      await service.updateService(SERVICE_ID, {
        envVarsPatch: { unset: ['ROTATE_ME'] },
      });

      expect(mockUpdateMachine).toHaveBeenCalledWith(
        expect.objectContaining({
          envVars: { KEEP: 'k' },
        })
      );
    });

    it('rejects when both envVars (wholesale) and envVarsPatch are sent', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [baseRow] });

      await expect(
        service.updateService(SERVICE_ID, {
          envVars: { ALL: 'replace' },
          envVarsPatch: { set: { ONE: 'merge' } },
        })
      ).rejects.toThrow('mutually exclusive');

      // No DB write should have happened — the guard rejects before any
      // mutation. Only the initial getService SELECT ran.
      expect(mockUpdateMachine).not.toHaveBeenCalled();
    });
  });

  describe('getServiceLogs', () => {
    const serviceRow = {
      id: 'svc-logs-1',
      project_id: 'proj-123',
      name: 'my-api',
      image_url: 'nginx:latest',
      port: 8080,
      cpu: 'shared-1x',
      memory: 256,
      region: 'iad',
      provider_app_id: 'my-api-proj-123',
      provider_instance_id: 'machine-1',
      status: 'running',
      endpoint_url: 'https://my-api-proj-123.fly.dev',
      env_vars_encrypted: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    it('delegates to provider.getLogs with the app, machine, and options', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [serviceRow] }); // getService
      const payload = { lines: [{ timestamp: 1, message: 'hi' }], nextToken: '42' };
      mockGetLogs.mockResolvedValue(payload);

      const result = await service.getServiceLogs('svc-logs-1', { limit: 200, nextToken: 'cur' });

      expect(mockGetLogs).toHaveBeenCalledWith('my-api-proj-123', 'machine-1', {
        limit: 200,
        nextToken: 'cur',
      });
      expect(result).toEqual(payload);
    });

    it('throws COMPUTE_SERVICE_NOT_FOUND when the service has no machine yet', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ ...serviceRow, provider_app_id: null, provider_instance_id: null }],
      });

      await expect(service.getServiceLogs('svc-logs-1')).rejects.toThrow('Service not found');
      expect(mockGetLogs).not.toHaveBeenCalled();
    });
  });
});

// NOTE: Route-level integration tests for compute endpoints are deferred —
// supertest is not used in this repo. Unit coverage at the service layer is
// comprehensive; HTTP-layer wiring is validated via type-checked route
// definitions and manual QA.

describe('selectComputeProvider factory', () => {
  beforeEach(() => {
    vi.resetModules();
    // Unmock the provider modules so the factory calls REAL isConfigured()
    // methods driven by the `config` mock for each test.
    vi.doUnmock('@/providers/compute/fly.provider.js');
    vi.doUnmock('@/providers/compute/cloud.provider.js');
  });

  it('returns FlyProvider when FLY_API_TOKEN is set', async () => {
    vi.doMock('@/infra/config/app.config.js', () => {
      const c = {
        fly: { apiToken: 'tok', org: 'o', enabled: true, domain: 'd' },
        docker: { socketPath: '/nonexistent/insforge-test-docker.sock' },
        cloud: { projectId: 'local', apiHost: '' },
        app: { jwtSecret: 'x' },
      };
      return {
        config: c,
        appConfig: c,
      };
    });
    const { selectComputeProvider } = await import('@/services/compute/services.service.js');
    const { FlyProvider } = await import('@/providers/compute/fly.provider.js');
    expect(selectComputeProvider()).toBe(FlyProvider.getInstance());
  });

  it('returns CloudComputeProvider when PROJECT_ID is provisioned and no FLY_API_TOKEN', async () => {
    process.env.AWS_INSTANCE_PROFILE_NAME = 'EC2-role';
    vi.doMock('@/infra/config/app.config.js', () => {
      const c = {
        fly: { apiToken: '', org: '', enabled: false, domain: '' },
        docker: { socketPath: '/nonexistent/insforge-test-docker.sock' },
        cloud: { projectId: 'p', apiHost: 'https://x' },
        app: { jwtSecret: 'x' },
      };
      return {
        config: c,
        appConfig: c,
      };
    });
    const { selectComputeProvider } = await import('@/services/compute/services.service.js');
    const { CloudComputeProvider } = await import('@/providers/compute/cloud.provider.js');
    expect(selectComputeProvider()).toBe(CloudComputeProvider.getInstance());
  });

  it('throws COMPUTE_NOT_CONFIGURED when neither is set', async () => {
    vi.doMock('@/infra/config/app.config.js', () => {
      const c = {
        fly: { apiToken: '', org: '', enabled: false, domain: '' },
        docker: { socketPath: '/nonexistent/insforge-test-docker.sock' },
        cloud: { projectId: 'local', apiHost: '' },
        app: { jwtSecret: 'x' },
      };
      return {
        config: c,
        appConfig: c,
      };
    });
    const { selectComputeProvider } = await import('@/services/compute/services.service.js');
    expect(() => selectComputeProvider()).toThrow(/COMPUTE_NOT_CONFIGURED|not configured/);
  });
});

describe('buildComputeRegistry', () => {
  const flyConfigured = () => {
    vi.doMock('@/infra/config/app.config.js', () => {
      const c = {
        fly: { apiToken: 'tok', org: 'o', enabled: true, domain: 'd' },
        docker: { socketPath: '/nonexistent/insforge-test-docker.sock' },
        cloud: { projectId: 'p', apiHost: 'https://x' },
        app: { jwtSecret: 'x' },
      };
      return { config: c, appConfig: c };
    });
  };

  /** Fly credentials present, but NOT a cloud-managed project. */
  const selfHostedFly = () => {
    vi.doMock('@/infra/config/app.config.js', () => {
      const c = {
        fly: { apiToken: 'tok', org: 'o', enabled: true, domain: 'd' },
        docker: { socketPath: '/nonexistent/insforge-test-docker.sock' },
        cloud: { projectId: 'local', apiHost: '' },
        app: { jwtSecret: 'x' },
      };
      return { config: c, appConfig: c };
    });
  };

  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock('@/providers/compute/fly.provider.js');
    vi.doUnmock('@/providers/compute/cloud.provider.js');
    delete process.env.COMPUTE_PROVIDER;
  });

  afterEach(() => {
    delete process.env.COMPUTE_PROVIDER;
  });

  // Self-host Fly and cloud-proxied mode are two credential paths to the same
  // Fly resources, so registering both would put two sets of credentials on one
  // set of apps. They share the 'fly' key, which makes that impossible.
  it('registers fly and cloud under a single key, self-host winning', async () => {
    flyConfigured();
    const { buildComputeRegistry } = await import('@/services/compute/services.service.js');
    const { FlyProvider } = await import('@/providers/compute/fly.provider.js');
    const registry = buildComputeRegistry();

    expect([...registry.providers.keys()]).toEqual(['fly']);
    expect(registry.providers.get('fly')).toBe(FlyProvider.getInstance());
    expect(registry.defaultProvider).toBe('fly');
  });

  it('COMPUTE_PROVIDER=cloud selects the cloud credential path for the fly key', async () => {
    process.env.AWS_INSTANCE_PROFILE_NAME = 'EC2-role';
    flyConfigured();
    process.env.COMPUTE_PROVIDER = 'cloud';
    const { buildComputeRegistry } = await import('@/services/compute/services.service.js');
    const { CloudComputeProvider } = await import('@/providers/compute/cloud.provider.js');
    const registry = buildComputeRegistry();

    expect(registry.providers.get('fly')).toBe(CloudComputeProvider.getInstance());
    expect(registry.defaultProvider).toBe('fly');
  });

  it('COMPUTE_PROVIDER=off disables compute outright', async () => {
    flyConfigured();
    process.env.COMPUTE_PROVIDER = 'off';
    const { buildComputeRegistry } = await import('@/services/compute/services.service.js');
    expect(() => buildComputeRegistry()).toThrow(/disabled/);
  });

  it('rejects an unknown COMPUTE_PROVIDER rather than silently falling back', async () => {
    flyConfigured();
    process.env.COMPUTE_PROVIDER = 'kubernetes';
    const { buildComputeRegistry } = await import('@/services/compute/services.service.js');
    expect(() => buildComputeRegistry()).toThrow(/Unknown COMPUTE_PROVIDER/);
  });

  // The dashboard renders this text verbatim as its not-configured empty state, so
  // it is the entire set of instructions a self-hoster gets. Fly-only advice left
  // them with no way to discover the Docker socket, which needs no third-party
  // account and is the easier path.
  it('names both providers when nothing is configured', async () => {
    vi.doMock('@/infra/config/app.config.js', () => {
      const c = {
        fly: { apiToken: '', org: '', enabled: false, domain: '' },
        docker: { socketPath: '/nonexistent/insforge-test-docker.sock' },
        cloud: { projectId: 'local', apiHost: '' },
        app: { jwtSecret: 'x' },
      };
      return { config: c, appConfig: c };
    });
    delete process.env.COMPUTE_PROVIDER;
    const { buildComputeRegistry } = await import('@/services/compute/services.service.js');

    let thrown: unknown;
    try {
      buildComputeRegistry();
    } catch (e) {
      thrown = e;
    }
    const next = (thrown as { nextActions?: string }).nextActions ?? '';
    expect(next).toMatch(/Docker socket/);
    expect(next).toMatch(/uncomment the Docker socket volume/i);
    expect(next).toMatch(/insforge-test-docker\.sock/);
    expect(next).toMatch(/FLY_API_TOKEN/);
    // Docker first: it is the option a self-hoster can act on without signing up.
    expect(next.indexOf('Docker socket')).toBeLessThan(next.indexOf('FLY_API_TOKEN'));
  });

  // Naming a default that isn't configured is a stated intent we can't honour —
  // failing at startup beats 500-ing on the operator's first deploy. The message
  // names the socket path it looked at, since a wrong DOCKER_SOCKET_PATH or a
  // missing compose mount is the whole failure mode.
  it('rejects COMPUTE_PROVIDER=docker when no socket is present', async () => {
    selfHostedFly();
    process.env.COMPUTE_PROVIDER = 'docker';
    const { buildComputeRegistry } = await import('@/services/compute/services.service.js');
    expect(() => buildComputeRegistry()).toThrow(
      /no Docker socket at .*insforge-test-docker\.sock/
    );
  });

  // The Docker driver's safety argument is that the operator and the developer
  // deploying containers are the same principal. On a cloud-managed project they
  // are not — the operator is InsForge and the developer is a customer — so a
  // customer creating containers on shared infrastructure is a tenant escape.
  // Fail closed, and say the real reason rather than blaming a missing socket.
  // A PaaS-supplied PROJECT_ID used to satisfy CloudComputeProvider.isConfigured(),
  // registering a cloud driver that signs with the operator's own JWT_SECRET.
  it('does not register the cloud driver for a self-host that sets PROJECT_ID', async () => {
    vi.doMock('@/infra/config/app.config.js', () => {
      const c = {
        fly: { apiToken: '', org: '', enabled: false, domain: '' },
        docker: { socketPath: '/nonexistent/insforge-test-docker.sock' },
        cloud: { projectId: 'zeabur-project-1', apiHost: 'https://api.insforge.dev' },
        app: { jwtSecret: 'x' },
      };
      return { config: c, appConfig: c };
    });
    const { buildComputeRegistry } = await import('@/services/compute/services.service.js');

    expect(() => buildComputeRegistry()).toThrow(/not configured|no compute/i);
  });

  it('refuses the Docker driver on a cloud-managed project', async () => {
    process.env.AWS_INSTANCE_PROFILE_NAME = 'EC2-role';
    flyConfigured(); // cloud projectId + apiHost present
    process.env.COMPUTE_PROVIDER = 'docker';
    const { buildComputeRegistry } = await import('@/services/compute/services.service.js');
    expect(() => buildComputeRegistry()).toThrow(/self-host only/);
  });

  it('never registers Docker on a cloud-managed project, socket or not', async () => {
    process.env.AWS_INSTANCE_PROFILE_NAME = 'EC2-role';
    flyConfigured();
    const { DockerProvider } = await import('@/providers/compute/docker.provider.js');
    // isConfigured is the "can I be used at all" question, so the guard lives
    // there too — any future caller inherits it, not just the registry.
    expect(DockerProvider.getInstance().isConfigured()).toBe(false);

    const { buildComputeRegistry } = await import('@/services/compute/services.service.js');
    expect([...buildComputeRegistry().providers.keys()]).toEqual(['fly']);
  });

  // Presence/absence of the slice is the coarse "is compute available" signal, so
  // it has to be absent rather than throwing or returning an empty object — a
  // caller gating a whole feature must not have to first make a request that 503s.
  it('omits the metadata slice entirely when no provider is configured', async () => {
    vi.doMock('@/infra/config/app.config.js', () => {
      const c = {
        fly: { apiToken: '', org: '', enabled: false, domain: '' },
        docker: { socketPath: '/nonexistent/insforge-test-docker.sock' },
        cloud: { projectId: 'local', apiHost: '' },
        app: { jwtSecret: 'x' },
      };
      return { config: c, appConfig: c };
    });
    const { getComputeMetadata } = await import('@/services/compute/services.service.js');
    expect(getComputeMetadata()).toBeUndefined();
  });

  it('omits the slice when compute is explicitly disabled', async () => {
    selfHostedFly();
    process.env.COMPUTE_PROVIDER = 'off';
    const { getComputeMetadata } = await import('@/services/compute/services.service.js');
    // `off` and `not configured` are the same answer to "should I offer compute".
    expect(getComputeMetadata()).toBeUndefined();
  });

  it('COMPUTE_PROVIDER=fly errors when Fly credentials are absent', async () => {
    vi.doMock('@/infra/config/app.config.js', () => {
      const c = {
        fly: { apiToken: '', org: '', enabled: false, domain: '' },
        docker: { socketPath: '/nonexistent/insforge-test-docker.sock' },
        cloud: { projectId: 'p', apiHost: 'https://x' },
        app: { jwtSecret: 'x' },
      };
      return { config: c, appConfig: c };
    });
    process.env.COMPUTE_PROVIDER = 'fly';
    const { buildComputeRegistry } = await import('@/services/compute/services.service.js');
    expect(() => buildComputeRegistry()).toThrow(/FLY_API_TOKEN/);
  });
});
