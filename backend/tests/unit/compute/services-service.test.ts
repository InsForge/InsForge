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
const mockIsConfigured = vi.fn();

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

      await expect(service.createService(input)).rejects.toThrow('Compute services are not enabled on this project.');
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

      await service.deleteService(serviceId);

      expect(mockDestroyMachine).toHaveBeenCalledWith('app-del-proj-123', 'machine-del');
      expect(mockDestroyApp).toHaveBeenCalledWith('app-del-proj-123');

      // First DB call after getService is the status update to 'destroying'
      const destroyingCall = mockQuery.mock.calls[1];
      expect(destroyingCall[0]).toContain('destroying');

      // Last DB call is the DELETE
      const deleteCall = mockQuery.mock.calls[mockQuery.mock.calls.length - 1];
      expect(deleteCall[0]).toContain('DELETE FROM compute.services');
      expect(deleteCall[1]).toEqual([serviceId]);
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

      // DELETE cleanup
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await expect(service.prepareForDeploy(input)).rejects.toThrow('Fly API error (500)');

      // Verify cleanup DELETE
      const deleteCall = mockQuery.mock.calls[1];
      expect(deleteCall[0]).toContain('DELETE FROM compute.services');
      expect(deleteCall[1]).toEqual([serviceId]);
    });
  });

  describe('syncAfterDeploy', () => {
    it('queries Fly for machines and updates DB with machineId and running status', async () => {
      const serviceId = 'svc-sync-1';

      // getService query
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: serviceId,
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
          },
        ],
      });

      mockListMachines.mockResolvedValue([
        { id: 'machine-new-1', state: 'started', region: 'iad' },
      ]);

      // UPDATE query
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: serviceId,
            project_id: 'proj-123',
            name: 'my-api',
            image_url: 'dockerfile',
            port: 8080,
            cpu: 'shared-1x',
            memory: 512,
            region: 'iad',
            fly_app_id: 'my-api-proj-123',
            fly_machine_id: 'machine-new-1',
            status: 'running',
            endpoint_url: 'https://my-api-proj-123.fly.dev',
            env_vars_encrypted: null,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
      });

      const result = await service.syncAfterDeploy(serviceId);

      expect(mockListMachines).toHaveBeenCalledWith('my-api-proj-123');

      const updateCall = mockQuery.mock.calls[1];
      expect(updateCall[0]).toContain('UPDATE compute.services');
      expect(updateCall[1]).toContain('machine-new-1');
      expect(updateCall[1]).toContain('running');

      expect(result.flyMachineId).toBe('machine-new-1');
      expect(result.status).toBe('running');
    });

    it('marks as failed when no machines found', async () => {
      const serviceId = 'svc-sync-2';

      // getService query
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: serviceId,
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
          },
        ],
      });

      mockListMachines.mockResolvedValue([]);

      // UPDATE to failed
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      // getService for return (after failed update)
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: serviceId,
            project_id: 'proj-123',
            name: 'my-api',
            image_url: 'dockerfile',
            port: 8080,
            cpu: 'shared-1x',
            memory: 512,
            region: 'iad',
            fly_app_id: 'my-api-proj-123',
            fly_machine_id: null,
            status: 'failed',
            endpoint_url: 'https://my-api-proj-123.fly.dev',
            env_vars_encrypted: null,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
      });

      const result = await service.syncAfterDeploy(serviceId);

      // Verify status set to failed (status is inline in SQL, not a param)
      const failedCall = mockQuery.mock.calls[1];
      expect(failedCall[0]).toContain('UPDATE compute.services');
      expect(failedCall[0]).toContain("'failed'");

      expect(result.status).toBe('failed');
    });

    it('throws COMPUTE_SERVICE_NOT_FOUND if the service is deleted concurrently', async () => {
      const serviceId = 'svc-sync-race';

      // getService query returns the row
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: serviceId,
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
          },
        ],
      });

      mockListMachines.mockResolvedValue([
        { id: 'machine-1', state: 'started', region: 'iad' },
      ]);

      // UPDATE returns zero rows — service was deleted between getService and UPDATE
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await expect(service.syncAfterDeploy(serviceId)).rejects.toThrow('Service not found');
    });

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
});

// NOTE: Route-level integration tests for compute endpoints are deferred —
// supertest is not used in this repo. Unit coverage at the service layer is
// comprehensive; HTTP-layer wiring is validated via type-checked route
// definitions and manual QA.

describe('selectComputeProvider factory', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns FlyProvider when FLY_API_TOKEN is set (direct-Fly mode wins over cloud)', async () => {
    vi.doMock('@/infra/config/app.config.js', () => ({
      config: {
        fly: { apiToken: 'tok', org: 'o', enabled: true, domain: 'd' },
        cloud: { projectId: 'p', apiHost: 'https://x' },
        app: { jwtSecret: 'x' },
      },
    }));
    const { selectComputeProvider } = await import('@/services/compute/services.service.js');
    const { FlyProvider } = await import('@/providers/compute/fly.provider.js');
    expect(selectComputeProvider()).toBe(FlyProvider.getInstance());
  });

  it('returns CloudComputeProvider when PROJECT_ID + JWT_SECRET are real (no FLY_API_TOKEN)', async () => {
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

  it('throws COMPUTE_NOT_CONFIGURED when projectId is the "local" default', async () => {
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

  it('throws COMPUTE_NOT_CONFIGURED when JWT_SECRET is missing', async () => {
    vi.doMock('@/infra/config/app.config.js', () => ({
      config: {
        fly: { apiToken: '', org: '', enabled: false, domain: '' },
        cloud: { projectId: 'p', apiHost: 'https://x' },
        app: { jwtSecret: '' },
      },
    }));
    const { selectComputeProvider } = await import('@/services/compute/services.service.js');
    expect(() => selectComputeProvider()).toThrow(/COMPUTE_NOT_CONFIGURED|not configured/);
  });
});
