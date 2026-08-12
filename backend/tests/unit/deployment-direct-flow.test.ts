import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';
import { Readable } from 'stream';

const { mockPool, mockClient, mockVercelProvider, mockIsCloudEnvironment } = vi.hoisted(() => ({
  mockPool: {
    connect: vi.fn(),
    query: vi.fn(),
  },
  mockClient: {
    query: vi.fn(),
    release: vi.fn(),
  },
  mockVercelProvider: {
    isConfigured: vi.fn(() => true),
    uploadFileStream: vi.fn(),
    listCustomDomains: vi.fn(),
    getCustomDomainConfig: vi.fn(),
  },
  mockIsCloudEnvironment: vi.fn(() => true),
}));

vi.mock('../../src/utils/environment.js', () => ({
  isCloudEnvironment: mockIsCloudEnvironment,
}));

vi.mock('../../src/infra/database/database.manager.js', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => mockPool,
    }),
  },
}));

vi.mock('../../src/providers/deployments/vercel.provider.js', () => ({
  VercelProvider: {
    getInstance: () => mockVercelProvider,
  },
}));

vi.mock('../../src/providers/storage/s3.provider.js', () => ({
  S3StorageProvider: vi.fn(),
}));

import { DeploymentService } from '../../src/services/deployments/deployment.service';
import { DeploymentStatus } from '../../src/types/deployments';
import { ERROR_CODES } from '@insforge/shared-schemas';

describe('DeploymentService direct deployment flow', () => {
  beforeEach(() => {
    // resetAllMocks drains the mockResolvedValueOnce queue (clearAllMocks does
    // not), preventing stale queue entries from bleeding into later tests.
    vi.resetAllMocks();
    mockPool.connect.mockResolvedValue(mockClient);
    mockVercelProvider.isConfigured.mockReturnValue(true);
    mockIsCloudEnvironment.mockReturnValue(true);

    // @ts-expect-error resetting singleton for isolated unit tests
    DeploymentService.instance = undefined;
  });

  it('is configured outside cloud when Vercel credentials are configured', () => {
    mockIsCloudEnvironment.mockReturnValue(false);
    mockVercelProvider.isConfigured.mockReturnValue(true);

    const service = DeploymentService.getInstance();

    expect(service.isConfigured()).toBe(true);
  });

  it('lists user-owned custom domains outside cloud when Vercel credentials are configured', async () => {
    mockIsCloudEnvironment.mockReturnValue(false);
    mockVercelProvider.listCustomDomains.mockResolvedValueOnce([
      {
        id: 'domain-id',
        name: 'app.example.com',
        apexName: 'example.com',
        projectId: 'project-id',
        verified: true,
        redirect: null,
        redirectStatusCode: null,
        gitBranch: null,
        createdAt: 1,
        updatedAt: 2,
        verification: [],
      },
      {
        id: 'default-domain-id',
        name: 'default.vercel.app',
        apexName: 'vercel.app',
        projectId: 'project-id',
        verified: true,
        redirect: null,
        redirectStatusCode: null,
        gitBranch: null,
        createdAt: 1,
        updatedAt: 2,
        verification: [],
      },
    ]);
    mockVercelProvider.getCustomDomainConfig.mockResolvedValueOnce({
      recommendedCNAME: [{ rank: 1, value: 'cname.vercel-dns.com' }],
    });

    const service = DeploymentService.getInstance();
    const result = await service.listCustomDomains();

    expect(result).toEqual({
      domains: [
        {
          domain: 'app.example.com',
          apexDomain: 'example.com',
          verified: true,
          misconfigured: false,
          verification: [],
          cnameTarget: 'cname.vercel-dns.com',
          aRecordValue: null,
        },
      ],
    });
  });

  it('creates a direct deployment and stores its manifest in one transaction', async () => {
    mockIsCloudEnvironment.mockReturnValue(false);
    const deploymentId = '11111111-1111-4111-8111-111111111111';
    const fileId = '22222222-2222-4222-8222-222222222222';

    mockClient.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: deploymentId,
            providerDeploymentId: null,
            provider: 'vercel',
            status: DeploymentStatus.WAITING,
            url: null,
            metadata: {},
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            fileId,
            deploymentId,
            path: 'src/index.ts',
            sha: 'a'.repeat(40),
            size: 12,
            uploadedAt: null,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const service = DeploymentService.getInstance();
    const result = await service.createDirectDeployment({
      files: [{ path: 'src/index.ts', sha: 'A'.repeat(40), size: 12 }],
    });

    expect(result).toEqual({
      id: deploymentId,
      status: DeploymentStatus.WAITING,
      files: [
        {
          fileId,
          path: 'src/index.ts',
          sha: 'a'.repeat(40),
          size: 12,
          uploadedAt: null,
        },
      ],
    });

    expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');

    const insertFilesCall = mockClient.query.mock.calls.find((call) =>
      String(call[0]).includes('INSERT INTO deployments.files')
    );
    expect(insertFilesCall?.[1]).toEqual([deploymentId, ['src/index.ts'], ['a'.repeat(40)], [12]]);
  });

  it('rejects duplicate manifest paths before opening a transaction', async () => {
    const service = DeploymentService.getInstance();

    await expect(
      service.createDirectDeployment({
        files: [
          { path: 'src/index.ts', sha: 'a'.repeat(40), size: 12 },
          { path: 'src/index.ts', sha: 'b'.repeat(40), size: 13 },
        ],
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_INPUT',
    });

    expect(mockPool.connect).not.toHaveBeenCalled();
  });

  /**
   * Route-level behavioral assertions for domain-specific error codes.
   *
   * These tests confirm that the service layer surfaces the new domain-scoped
   * codes rather than the former generic NOT_FOUND / INVALID_INPUT codes.
   * They directly address the PR review finding that "no test asserts that the
   * affected routes actually return the new domain-specific codes."
   */

  it('returns DEPLOYMENT_NOT_FOUND when the deployment record does not exist', async () => {
    // Simulate a pool query that returns an empty rows array — deployment absent
    mockPool.query
      .mockResolvedValueOnce({ rows: [] }) // getDeployment → no match
      .mockResolvedValueOnce({ rows: [] }); // getDeploymentFiles → no match

    const service = DeploymentService.getInstance();

    await expect(
      service.uploadDeploymentFileContent(
        '00000000-0000-4000-8000-000000000000',
        '11111111-1111-4111-8111-111111111111',
        Readable.from([Buffer.from('data')])
      )
    ).rejects.toMatchObject({
      statusCode: 404,
      code: ERROR_CODES.DEPLOYMENT_NOT_FOUND,
    });
  });

  it('returns DEPLOYMENT_NOT_FOUND when the file record does not exist within a valid deployment', async () => {
    const deploymentId = '11111111-1111-4111-8111-111111111111';

    mockPool.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: deploymentId,
            providerDeploymentId: null,
            provider: 'vercel',
            status: DeploymentStatus.WAITING,
            url: null,
            metadata: { uploadMode: 'direct' },
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] }); // no file row for the given fileId

    const service = DeploymentService.getInstance();

    await expect(
      service.uploadDeploymentFileContent(
        deploymentId,
        'ffffffff-ffff-4fff-8fff-ffffffffffff',
        Readable.from([Buffer.from('data')])
      )
    ).rejects.toMatchObject({
      statusCode: 404,
      code: ERROR_CODES.DEPLOYMENT_NOT_FOUND,
    });
  });

  it('streams a registered file to Vercel and marks it uploaded', async () => {
    const deploymentId = '11111111-1111-4111-8111-111111111111';
    const fileId = '22222222-2222-4222-8222-222222222222';
    const content = Buffer.from('hello');
    const uploadedAt = new Date('2026-04-15T12:00:00.000Z');
    const sha = createHash('sha1').update(content).digest('hex');

    mockPool.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: deploymentId,
            providerDeploymentId: null,
            provider: 'vercel',
            status: DeploymentStatus.WAITING,
            url: null,
            metadata: { uploadMode: 'direct' },
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            fileId,
            deploymentId,
            path: 'src/index.ts',
            sha,
            size: content.length,
            uploadedAt: null,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] }) // updateDeploymentStatus → UPLOADING (start)
      .mockResolvedValueOnce({
        rows: [
          {
            fileId,
            deploymentId,
            path: 'src/index.ts',
            sha,
            size: content.length,
            uploadedAt,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    mockVercelProvider.uploadFileStream.mockImplementationOnce(
      async (input: { content: Readable; sha: string; size: number }) => {
        for await (const chunk of input.content) {
          expect(chunk).toBeDefined();
        }
        return input.sha;
      }
    );

    const service = DeploymentService.getInstance();
    const result = await service.uploadDeploymentFileContent(
      deploymentId,
      fileId,
      Readable.from([content])
    );

    expect(result).toEqual({
      fileId,
      path: 'src/index.ts',
      sha,
      size: content.length,
      uploadedAt: uploadedAt.toISOString(),
    });
    expect(mockVercelProvider.uploadFileStream).toHaveBeenCalledWith(
      expect.objectContaining({ sha, size: content.length })
    );
  });

  it('rejects uploaded content that does not match the registered SHA', async () => {
    const deploymentId = '11111111-1111-4111-8111-111111111111';
    const fileId = '22222222-2222-4222-8222-222222222222';
    const content = Buffer.from('hello');

    mockPool.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: deploymentId,
            providerDeploymentId: null,
            provider: 'vercel',
            status: DeploymentStatus.WAITING,
            url: null,
            metadata: { uploadMode: 'direct' },
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            fileId,
            deploymentId,
            path: 'src/index.ts',
            sha: 'a'.repeat(40),
            size: content.length,
            uploadedAt: null,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] }); // updateDeploymentStatus → UPLOADING (start)

    // Must consume the stream so the SHA-validation Transform fires.
    mockVercelProvider.uploadFileStream.mockImplementationOnce(
      async (input: { content: Readable; sha: string; size: number }) => {
        for await (const chunk of input.content) {
          void chunk; // drain — SHA mismatch will be thrown by the Transform
        }
        return input.sha;
      }
    );

    const service = DeploymentService.getInstance();

    await expect(
      service.uploadDeploymentFileContent(deploymentId, fileId, Readable.from([content]))
    ).rejects.toMatchObject({
      statusCode: 400,
      // SHA mismatch is caught inside createFileValidationTransform. It uses
      // INVALID_INPUT because the client sent body content that doesn't match
      // the SHA the client registered — a client input error, not a deployment
      // resource error. This is distinct from DEPLOYMENT_INVALID_FILE, which
      // is used for structural issues with the deployment (wrong upload mode,
      // Vercel rejecting the file, etc.).
      code: 'INVALID_INPUT',
    });
  });
});
