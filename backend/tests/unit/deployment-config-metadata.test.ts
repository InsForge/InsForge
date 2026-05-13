import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockVercelProvider, mockIsCloudEnvironment } = vi.hoisted(() => ({
  mockVercelProvider: {
    getSlug: vi.fn<[], Promise<string | null>>(),
  },
  mockIsCloudEnvironment: vi.fn(() => true),
}));

vi.mock('../../src/utils/environment.js', () => ({
  isCloudEnvironment: mockIsCloudEnvironment,
}));

vi.mock('../../src/infra/database/database.manager.js', () => ({
  DatabaseManager: { getInstance: () => ({ getPool: () => ({}) }) },
}));

vi.mock('../../src/providers/deployments/vercel.provider.js', () => ({
  VercelProvider: { getInstance: () => mockVercelProvider },
}));

vi.mock('../../src/providers/storage/s3.provider.js', () => ({
  S3StorageProvider: vi.fn(),
}));

import { DeploymentService } from '../../src/services/deployments/deployment.service';

describe('DeploymentService.getConfigMetadata', () => {
  let service: DeploymentService;

  beforeEach(() => {
    vi.clearAllMocks();
    // The singleton is set up once per module load; safe to reuse across tests
    // because getConfigMetadata reads no instance state.
    service = DeploymentService.getInstance();
  });

  it('self-host (not cloud) → undefined so the metadata route omits the slice', async () => {
    // Slice presence is the CLI capability probe. Absent slice = self-host
    // signal; the CLI must not see { customSlug: null } here, or it would
    // try to apply [deployments] sections against a backend that can't
    // honor them.
    mockIsCloudEnvironment.mockReturnValue(false);

    const result = await service.getConfigMetadata();

    expect(result).toBeUndefined();
    expect(mockVercelProvider.getSlug).not.toHaveBeenCalled();
  });

  it('cloud + slug set → { customSlug: "myapp" }', async () => {
    mockIsCloudEnvironment.mockReturnValue(true);
    mockVercelProvider.getSlug.mockResolvedValue('myapp');

    const result = await service.getConfigMetadata();

    expect(result).toEqual({ customSlug: 'myapp' });
  });

  it('cloud + no slug set → { customSlug: null } (slice present, slug null)', async () => {
    mockIsCloudEnvironment.mockReturnValue(true);
    mockVercelProvider.getSlug.mockResolvedValue(null);

    const result = await service.getConfigMetadata();

    expect(result).toEqual({ customSlug: null });
  });

  it('cloud + getSlug throws → { customSlug: null } so /api/metadata stays available', async () => {
    // Transient Vercel/CLOUD_API errors must not 500 the whole admin
    // metadata endpoint. Returning { customSlug: null } preserves the
    // "this is cloud" signal so the CLI doesn't misread the failure as
    // self-host.
    mockIsCloudEnvironment.mockReturnValue(true);
    mockVercelProvider.getSlug.mockRejectedValue(new Error('vercel down'));

    const result = await service.getConfigMetadata();

    expect(result).toEqual({ customSlug: null });
  });
});
