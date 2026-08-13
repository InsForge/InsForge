import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ERROR_CODES } from '@insforge/shared-schemas';

const { mockPool, mockClient, mockProvider, active } = vi.hoisted(() => {
  const provider = {
    name: 'docker' as const,
    isConfigured: vi.fn(() => true),
    capabilities: vi.fn(() => ({ envVars: 'build-only', rollback: true, customDomains: false })),
    rollbackTo: vi.fn(),
  };
  return {
    mockPool: { connect: vi.fn(), query: vi.fn() },
    mockClient: { query: vi.fn(), release: vi.fn() },
    mockProvider: provider,
    // Which driver the registry hands back. A holder rather than a spy: a spy on the
    // registry module survives clearAllMocks and leaks into the next test, which is
    // exactly how the first version of this file passed for the wrong reason.
    active: { provider: provider as unknown },
  };
});

vi.mock('../../src/infra/config/app.config.js', () => {
  const c = {
    cloud: { projectId: undefined, apiHost: 'https://cloud.test' },
    app: { jwtSecret: 's'.repeat(32), logLevel: 'error' },
    server: { logsDir: '/tmp/insforge-sites-rollback-logs' },
    deployments: { sitesDomain: '', sitesStagingDir: '/tmp/insforge-sites-rollback-staging' },
    storage: {},
    docker: { socketPath: '/nonexistent/test.sock' },
  };
  return { config: c, appConfig: c };
});

vi.mock('../../src/infra/database/database.manager.js', () => ({
  DatabaseManager: { getInstance: () => ({ getPool: () => mockPool }) },
}));

// The registry is the seam under test's collaborator: rollback has to reach whichever
// driver is active, and refuse by name for one that cannot do it.
vi.mock('../../src/services/deployments/sites-registry.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/services/deployments/sites-registry.js')>();
  return {
    ...actual,
    selectSitesProvider: () => active.provider,
    isAnySitesProviderConfigured: () => true,
    // Only the docker driver exists on this instance, which is what makes the
    // cross-driver refusal below reachable.
    buildSitesRegistry: () => ({
      providers: new Map([['docker', active.provider]]),
      defaultProvider: 'docker',
    }),
  };
});

vi.mock('../../src/providers/storage/s3.provider.js', () => ({ S3StorageProvider: vi.fn() }));
vi.mock('../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { DeploymentService, truncateBuildLogs } =
  await import('../../src/services/deployments/deployment.service.js');

const RESTORED = {
  id: 'container-old',
  url: 'http://host:49154',
  state: 'running',
  readyState: 'READY',
  name: 'insforge-site-local:abc',
  createdAt: new Date(),
};

function rowFor(id: string, providerDeploymentId: string | null) {
  return { id, providerDeploymentId, provider: 'docker', status: 'CANCELED', url: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  active.provider = mockProvider;
  mockPool.connect.mockResolvedValue(mockClient);
  mockProvider.capabilities.mockReturnValue({ envVars: 'build-only', rollback: true } as never);
  mockProvider.rollbackTo.mockResolvedValue(RESTORED);
});

describe('DeploymentService.rollbackTo', () => {
  it('restores through the driver and records the row as live', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [rowFor('row-1', 'container-old')] });
    mockClient.query.mockResolvedValue({
      rows: [{ ...rowFor('row-1', 'container-old'), status: 'READY' }],
    });

    const result = await DeploymentService.getInstance().rollbackTo('row-1');

    expect(mockProvider.rollbackTo).toHaveBeenCalledWith('container-old');
    expect(result.status).toBe('READY');
  });

  // Two rows both claiming READY would make the history lie about what is serving.
  it('demotes the other live row inside the same transaction', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [rowFor('row-1', 'container-old')] });
    mockClient.query.mockResolvedValue({
      rows: [{ ...rowFor('row-1', 'container-old'), status: 'READY' }],
    });

    await DeploymentService.getInstance().rollbackTo('row-1');

    const statements = mockClient.query.mock.calls.map(([sql]) => String(sql).trim());
    expect(statements[0]).toBe('BEGIN');
    expect(statements[1]).toContain("SET status = 'CANCELED'");
    expect(statements[1]).toContain('id <> $2');
    expect(statements[2]).toContain('UPDATE deployments.runs');
    expect(statements[3]).toBe('COMMIT');
  });

  it('rolls the transaction back when the update fails', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [rowFor('row-1', 'container-old')] });
    mockClient.query.mockImplementation((sql: string) => {
      if (String(sql).includes('UPDATE deployments.runs\n         SET status')) {
        return Promise.reject(new Error('deadlock detected'));
      }
      return Promise.resolve({ rows: [] });
    });

    await expect(DeploymentService.getInstance().rollbackTo('row-1')).rejects.toThrow(
      'deadlock detected'
    );

    expect(mockClient.query.mock.calls.map(([sql]) => String(sql))).toContain('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalled();
  });

  // A row that never reached the provider has no artifact to restore, which is a
  // different failure from a driver that cannot roll back at all.
  it('refuses a row that never reached the provider', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [rowFor('row-1', null)] });

    await expect(DeploymentService.getInstance().rollbackTo('row-1')).rejects.toThrow(
      'never reached the provider'
    );
    expect(mockProvider.rollbackTo).not.toHaveBeenCalled();
  });

  it('names the driver when it cannot roll back', async () => {
    active.provider = { ...mockProvider, rollbackTo: undefined };
    mockPool.query.mockResolvedValueOnce({ rows: [rowFor('row-1', 'container-old')] });

    await expect(DeploymentService.getInstance().rollbackTo('row-1')).rejects.toThrow(
      'The docker sites driver does not support rollback'
    );
  });

  // The row records which driver made it, so a Vercel deployment must not be handed to
  // Docker: the id means nothing there, and the wrong driver's capabilities answer.
  it('refuses a row that belongs to a driver that is not configured here', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ ...rowFor('row-1', 'dpl_vercel_1'), provider: 'vercel' }],
    });

    await expect(DeploymentService.getInstance().rollbackTo('row-1')).rejects.toThrow(
      'made by the vercel driver, which is not configured here'
    );
    expect(mockProvider.rollbackTo).not.toHaveBeenCalled();
  });

  it('reports not-found for a row that does not exist', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    await expect(DeploymentService.getInstance().rollbackTo('missing')).rejects.toThrow(
      expect.objectContaining({ statusCode: 404, code: ERROR_CODES.DEPLOYMENT_NOT_FOUND })
    );
  });
});

describe('truncateBuildLogs', () => {
  // The error is at the end of a failing build, and this lands in a jsonb column on every
  // deploy — so the tail is kept and the caller is told what was dropped.
  it('keeps the tail and says how much it dropped', () => {
    const lines = Array.from({ length: 250 }, (_, i) => `line ${i}`);

    const kept = truncateBuildLogs(lines);

    expect(kept).toHaveLength(201);
    expect(kept[0]).toBe('… 50 earlier line(s) omitted');
    expect(kept.at(-1)).toBe('line 249');
  });

  it('caps by bytes as well as lines', () => {
    const lines = Array.from({ length: 50 }, () => 'x'.repeat(4096));

    const kept = truncateBuildLogs(lines);

    const bytes = kept.slice(1).reduce((sum, line) => sum + Buffer.byteLength(line), 0);
    expect(bytes).toBeLessThanOrEqual(64 * 1024);
    expect(kept[0]).toMatch(/earlier line\(s\) omitted/);
  });

  it('passes a short log through unchanged', () => {
    expect(truncateBuildLogs(['Step 1/3 : FROM nginx:alpine'])).toEqual([
      'Step 1/3 : FROM nginx:alpine',
    ]);
  });
});

describe('DeploymentService.getMetadata', () => {
  // Shipped broken: the domain URL was fetched through requireDomainStore(), which throws
  // for a driver that owns no domains — so the whole response 400'd on the very driver
  // this work adds, taking currentDeploymentId and defaultDomainUrl with it. Both are
  // meaningful for every driver: the URL comes from the driver's own endpoint.
  it('answers without a custom domain when the driver owns no domains', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'row-live', url: 'http://localhost:49154' }],
    });

    await expect(DeploymentService.getInstance().getMetadata()).resolves.toEqual({
      currentDeploymentId: 'row-live',
      defaultDomainUrl: 'http://localhost:49154',
      customDomainUrl: null,
    });
  });

  it('still reports the custom domain for a driver that has one', async () => {
    active.provider = {
      ...mockProvider,
      domains: { url: vi.fn().mockResolvedValue('https://app.example.com') },
    };
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'row-live', url: 'https://x.dev' }] });

    await expect(DeploymentService.getInstance().getMetadata()).resolves.toMatchObject({
      customDomainUrl: 'https://app.example.com',
    });
  });
});

describe('DeploymentService row provenance', () => {
  // The seam rests on `deployments.runs.provider`: it is why no migration was needed and
  // how row-scoped operations find the right driver. Both inserts hardcoded 'vercel', so
  // every Docker deployment was recorded as a Vercel one and this test is what keeps that
  // from coming back.
  it('records the driver that actually made the deployment', async () => {
    mockClient.query.mockImplementation((sql: string) =>
      String(sql).includes('INSERT INTO deployments.runs')
        ? Promise.resolve({ rows: [{ id: 'row-new', provider: 'docker', status: 'WAITING' }] })
        : Promise.resolve({ rows: [] })
    );

    await DeploymentService.getInstance().createDirectDeployment({
      files: [{ path: 'index.html', sha: 'a'.repeat(40), size: 12 }],
    });

    const insert = mockClient.query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO deployments.runs')
    );
    expect(insert?.[1]?.[0]).toBe('docker');
  });
});
