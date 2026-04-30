import { describe, it, expect, vi, beforeEach } from 'vitest';

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

vi.mock('@/infra/config/app.config.js', () => ({
  config: {
    fly: {
      enabled: true,
      apiToken: 'test-token',
      org: 'test-org',
      domain: 'fly.dev',
    },
    cloud: {
      projectId: '',
      apiHost: '',
    },
    app: {
      jwtSecret: 'test-secret',
    },
  },
}));

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
const mockGetLogs = vi.fn();
const mockListMachines = vi.fn();
const mockIsConfigured = vi.fn(() => true);

const mockFlyInstance = {
  createApp: mockCreateApp,
  destroyApp: mockDestroyApp,
  launchMachine: mockLaunchMachine,
  updateMachine: mockUpdateMachine,
  stopMachine: mockStopMachine,
  startMachine: mockStartMachine,
  destroyMachine: mockDestroyMachine,
  getLogs: mockGetLogs,
  listMachines: mockListMachines,
  isConfigured: mockIsConfigured,
};

vi.mock('@/providers/compute/fly.provider.js', () => ({
  FlyProvider: {
    getInstance: () => mockFlyInstance,
  },
}));

import { ComputeServicesService } from '@/services/compute/services.service.js';

describe('ComputeServicesService', () => {
  let service: ComputeServicesService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = ComputeServicesService.getInstance();
    mockIsConfigured.mockReturnValue(true);
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
            fly_app_id: null,
            fly_machine_id: null,
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
            fly_app_id: 'my-api-proj-123',
            fly_machine_id: 'machine-abc',
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
      expect(mockCreateApp).toHaveBeenCalledWith({
        name: 'my-api-proj-123',
        network: 'proj-123-network',
        org: 'test-org',
      });
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
            fly_app_id: null,
            fly_machine_id: null,
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

    it('passes through structured cloud errors (quota, invalid input, etc.) instead of swallowing as generic 502', async () => {
      // Reproduces the bug found by stress-testing against staging:
      // when the cloud backend returns 403 COMPUTE_QUOTA_EXCEEDED with a clear
      // message ("Project X has reached 5 active services"), the OSS was
      // catching it and re-throwing as generic
      // "Compute service operation failed" 502 — losing the actual reason.
      const { AppError } = await import('@/api/middlewares/error.js');
      const { ERROR_CODES } = await import('@/types/error-constants.js');

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
            fly_app_id: null,
            fly_machine_id: null,
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
        '{"code":"COMPUTE_QUOTA_EXCEEDED","error":"Project e8a6b768 has reached 5 active services"}',
        403,
        (ERROR_CODES as { COMPUTE_PROVIDER_ERROR: string }).COMPUTE_PROVIDER_ERROR
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
      expect(thrown!.code).toBe('COMPUTE_QUOTA_EXCEEDED');
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
            fly_app_id: 'app-one-proj-123',
            fly_machine_id: 'machine-1',
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
            fly_app_id: 'app-del-proj-123',
            fly_machine_id: 'machine-del',
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
        flyAppId: 'app-del-proj-123',
        flyMachineId: 'machine-del',
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
            fly_app_id: 'app-env-proj-123',
            fly_machine_id: 'machine-env',
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
            fly_app_id: 'app-del2-proj-123',
            fly_machine_id: 'machine-del2',
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
            fly_app_id: 'my-api-proj-123',
            fly_machine_id: null,
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
      expect(mockCreateApp).toHaveBeenCalledWith({
        name: 'my-api-proj-123',
        network: 'proj-123-network',
        org: 'test-org',
      });

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
            fly_app_id: 'my-api-proj-123',
            fly_machine_id: null,
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
            fly_app_id: 'my-api-proj-123',
            fly_machine_id: null,
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
            fly_app_id: 'my-api-proj-123',
            fly_machine_id: null,
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

      await expect(service.prepareForDeploy(input)).rejects.toThrow(
        /IP allocation failed/
      );

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
      fly_app_id: 'my-api-proj-123',
      fly_machine_id: 'machine-1',
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
      fly_app_id: 'my-api-proj-123',
      fly_machine_id: 'machine-1',
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
      fly_app_id: 'my-api-proj-123',
      fly_machine_id: null,
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
            fly_machine_id: 'mach-pa-1',
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
      expect(updateCall[0]).toContain('fly_machine_id IS NULL');
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
      const { AppError } = await import('@/api/middlewares/error.js');
      const cloudBody = JSON.stringify({
        code: 'COMPUTE_QUOTA_EXCEEDED',
        error: 'Project compute quota exceeded',
        nextActions: ['upgrade plan', 'delete unused services'],
      });
      mockLaunchMachine.mockRejectedValue(new AppError(cloudBody, 403, 'COMPUTE_QUOTA_EXCEEDED'));

      await expect(
        service.updateService('svc-pa-1', { imageUrl: 'registry.fly.io/x:y' })
      ).rejects.toMatchObject({
        statusCode: 403,
        code: 'COMPUTE_QUOTA_EXCEEDED',
        message: 'Project compute quota exceeded',
      });

      // Final UPDATE must NOT have run — Fly call failed.
      expect(mockQuery.mock.calls.some((c) => String(c[0]).startsWith('UPDATE'))).toBe(false);
    });

    it('regression: existing machine + imageUrl takes the redeploy path (updateMachine, no launch, no optimistic lock)', async () => {
      const deployedRow = { ...baseRow, fly_machine_id: 'mach-existing', status: 'running' };
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
      expect(updateCall[0]).not.toContain('fly_machine_id IS NULL');
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
      const winningRow = { ...baseRow, fly_machine_id: 'mach-winner', status: 'running' };
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
      const winningRow = { ...baseRow, fly_machine_id: 'mach-winner', status: 'running' };
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
      fly_app_id: 'patch-svc-proj-1',
      fly_machine_id: 'mach-1',
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
      mockQuery.mockResolvedValueOnce({ rows: [{ env_vars_encrypted: baseRow.env_vars_encrypted }] });
      // 3. SELECT env_vars_encrypted for the Fly redeploy merge
      mockQuery.mockResolvedValueOnce({ rows: [{ env_vars_encrypted: baseRow.env_vars_encrypted }] });
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
      mockQuery.mockResolvedValueOnce({ rows: [{ env_vars_encrypted: baseRow.env_vars_encrypted }] });
      mockQuery.mockResolvedValueOnce({ rows: [{ env_vars_encrypted: baseRow.env_vars_encrypted }] });
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
    vi.doMock('@/infra/config/app.config.js', () => ({
      config: {
        fly: { apiToken: 'tok', org: 'o', enabled: true, domain: 'd' },
        cloud: { projectId: 'local', apiHost: '' },
        app: { jwtSecret: 'x' },
      },
    }));
    const { selectComputeProvider } = await import('@/services/compute/services.service.js');
    const { FlyProvider } = await import('@/providers/compute/fly.provider.js');
    expect(selectComputeProvider()).toBe(FlyProvider.getInstance());
  });

  it('returns CloudComputeProvider when PROJECT_ID is provisioned and no FLY_API_TOKEN', async () => {
    vi.doMock('@/infra/config/app.config.js', () => ({
      config: {
        fly: { apiToken: '', org: '', enabled: false, domain: '' },
        cloud: { projectId: 'p', apiHost: 'https://x' },
        app: { jwtSecret: 'x' },
      },
    }));
    const { selectComputeProvider } = await import('@/services/compute/services.service.js');
    const { CloudComputeProvider } = await import('@/providers/compute/cloud.provider.js');
    expect(selectComputeProvider()).toBe(CloudComputeProvider.getInstance());
  });

  it('throws COMPUTE_NOT_CONFIGURED when neither is set', async () => {
    vi.doMock('@/infra/config/app.config.js', () => ({
      config: {
        fly: { apiToken: '', org: '', enabled: false, domain: '' },
        cloud: { projectId: 'local', apiHost: '' },
        app: { jwtSecret: 'x' },
      },
    }));
    const { selectComputeProvider } = await import('@/services/compute/services.service.js');
    expect(() => selectComputeProvider()).toThrow(/COMPUTE_NOT_CONFIGURED|not configured/);
  });
});
