import { describe, it, expect, afterAll, beforeEach, vi } from 'vitest';
import { ERROR_CODES } from '@insforge/shared-schemas';
import { AppError, UpstreamError } from '../../src/utils/errors.js';

const { mockPool, mockClient, mockProvider, active, noDriver } = vi.hoisted(() => {
  const provider = {
    name: 'docker' as const,
    isConfigured: vi.fn(() => true),
    capabilities: vi.fn(() => ({ envVars: 'build-only', rollback: true, customDomains: false })),
    rollbackTo: vi.fn(),
    runtimeLogs: vi.fn(),
  };
  return {
    mockPool: { connect: vi.fn(), query: vi.fn() },
    mockClient: { query: vi.fn(), release: vi.fn() },
    mockProvider: provider,
    // Which driver the registry hands back. A holder rather than a spy: a spy on the
    // registry module survives clearAllMocks and leaks into the next test, which is
    // exactly how the first version of this file passed for the wrong reason.
    //
    // `other` is a second, non-default driver, which is what makes "did this reach the
    // row's driver or the active one?" an answerable question.
    active: { provider: provider as unknown, other: undefined as unknown },
    // Whether this instance has any sites driver at all — the case where reading
    // `this.provider` throws.
    noDriver: { configured: true },
  };
});

vi.mock('../../src/infra/config/app.config.js', () => {
  const c = {
    cloud: { projectId: undefined, apiHost: 'https://cloud.test' },
    app: { jwtSecret: 's'.repeat(32), logLevel: 'error' },
    server: { logsDir: '/tmp/insforge-sites-rollback-logs' },
    deployments: {
      sitesDomain: '',
      sitesStagingDir: '/tmp/insforge-sites-rollback-staging',
      // Small on purpose: the zip test allocates past this, and the real limit is 100MB.
      maxDeploymentTotalBytes: 4096,
    },
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
    // Throws when nothing is configured, exactly as the real one does — otherwise a test
    // cannot tell a guarded provider read from an unguarded one.
    selectSitesProvider: () => {
      if (!noDriver.configured) {
        throw new AppError(
          'No sites provider is configured.',
          503,
          ERROR_CODES.DEPLOYMENT_NOT_CONFIGURED
        );
      }
      return active.provider;
    },
    isAnySitesProviderConfigured: () => noDriver.configured,
    // Mocked as well as `selectSitesProvider`: the real `requireDomainStore` calls the real
    // `selectSitesProvider` inside its own module, where this mock cannot reach it.
    requireDomainStore: () => {
      const provider = active.provider as { name: string; domains?: unknown };
      if (!provider.domains) {
        throw actual.unsupportedFeature(provider.name, 'custom domains');
      }
      return provider.domains;
    },
    // `other` present means this instance has a second driver configured; absent is what
    // makes the cross-driver refusal below reachable.
    buildSitesRegistry: () => ({
      providers: new Map(
        active.other
          ? [
              ['docker', active.provider],
              ['vercel', active.other],
            ]
          : [['docker', active.provider]]
      ),
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
  noDriver.configured = true;
  active.other = {
    name: 'vercel' as const,
    isConfigured: () => true,
    capabilities: () => ({ envVars: 'runtime', rollback: false, slug: true }),
    envVars: { upsert: vi.fn(), keys: vi.fn(), list: vi.fn(), get: vi.fn(), remove: vi.fn() },
    uploadFiles: vi.fn().mockResolvedValue([]),
    createDeploymentWithFiles: vi.fn().mockResolvedValue({
      id: 'dpl_vercel_new',
      url: 'https://x.vercel.app',
      state: 'READY',
      readyState: 'READY',
      name: 'x',
      createdAt: new Date(),
    }),
  };
  mockPool.connect.mockResolvedValue(mockClient);
  mockProvider.capabilities.mockReturnValue({ envVars: 'runtime', rollback: true } as never);
  mockProvider.rollbackTo.mockResolvedValue(RESTORED);
  mockProvider.runtimeLogs.mockResolvedValue({ lines: [], nextToken: null });
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

  // Scoped to the row's driver: on an instance with both, demoting every READY row marks a
  // Vercel deployment CANCELED while Vercel keeps serving it, and getMetadata() reads the
  // latest READY row to decide what is live.
  it('demotes only rows made by the same driver', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [rowFor('row-1', 'container-old')] });
    mockClient.query.mockResolvedValue({
      rows: [{ ...rowFor('row-1', 'container-old'), status: 'READY' }],
    });

    await DeploymentService.getInstance().rollbackTo('row-1');

    const demote = mockClient.query.mock.calls.find(([sql]) =>
      String(sql).includes("SET status = 'CANCELED'")
    );
    expect(String(demote?.[0])).toContain('provider = $3');
    expect(demote?.[1]?.[2]).toBe('docker');
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

  // A broken connection makes ROLLBACK itself reject. Unguarded, that rejection replaced
  // the original error and skipped the log line that is the only record of the host and the
  // database disagreeing about what is live.
  it('reports the original failure even when the ROLLBACK also fails', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [rowFor('row-1', 'container-old')] });
    mockClient.query.mockImplementation((sql: string) => {
      if (String(sql).includes('UPDATE deployments.runs\n         SET status')) {
        return Promise.reject(new Error('deadlock detected'));
      }
      if (String(sql) === 'ROLLBACK') {
        return Promise.reject(new Error('connection terminated'));
      }
      return Promise.resolve({ rows: [] });
    });

    await expect(DeploymentService.getInstance().rollbackTo('row-1')).rejects.toThrow(
      'deadlock detected'
    );
    expect(mockClient.release).toHaveBeenCalled();
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
    active.other = undefined;
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

  // The one case where the operator most needs the text: a minified bundle or a stack
  // trace with no newlines. Returning only the marker threw away the answer.
  it('keeps a single over-long line, clipped, rather than only the marker', () => {
    const kept = truncateBuildLogs(['x'.repeat(200_000)]);

    expect(kept.length).toBeGreaterThan(0);
    expect(kept.at(-1)).toMatch(/line truncated\)$/);
    expect(Buffer.byteLength(kept.at(-1) ?? '')).toBeLessThan(64 * 1024 + 64);
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

describe('DeploymentService.getRuntimeLogs', () => {
  it("reads the row's own container through that row's driver", async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [rowFor('row-1', 'server-live')] });
    mockProvider.runtimeLogs.mockResolvedValue({
      lines: [{ timestamp: 1_700_000_000_000, message: 'listening' }],
      nextToken: null,
    });

    await expect(
      DeploymentService.getInstance().getRuntimeLogs('row-1', { limit: 50 })
    ).resolves.toEqual({
      lines: [{ timestamp: 1_700_000_000_000, message: 'listening' }],
      nextToken: null,
    });
    // The provider id, not the row id: they are different namespaces.
    expect(mockProvider.runtimeLogs).toHaveBeenCalledWith('server-live', { limit: 50 });
  });

  // Vercel has no runtime to read, and saying so by name beats an empty page that looks
  // like a server producing no output.
  it('names the driver when it cannot read runtime logs', async () => {
    active.provider = { ...mockProvider, runtimeLogs: undefined };
    mockPool.query.mockResolvedValueOnce({ rows: [rowFor('row-1', 'server-live')] });

    await expect(DeploymentService.getInstance().getRuntimeLogs('row-1')).rejects.toThrow(
      'The docker sites driver does not support runtime logs'
    );
  });

  it('refuses a row that never reached the provider', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [rowFor('row-1', null)] });

    await expect(DeploymentService.getInstance().getRuntimeLogs('row-1')).rejects.toThrow(
      'never reached the provider'
    );
    expect(mockProvider.runtimeLogs).not.toHaveBeenCalled();
  });

  it('reports not-found for a row that does not exist', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    await expect(DeploymentService.getInstance().getRuntimeLogs('missing')).rejects.toThrow(
      expect.objectContaining({ statusCode: 404, code: ERROR_CODES.DEPLOYMENT_NOT_FOUND })
    );
  });
});

describe('DeploymentService.envVarStore', () => {
  // The capability said `runtime` while every env-var route went through the driver's own
  // store — which Docker does not have — so the whole management API 400'd on the driver
  // this work adds. A flag that promises a feature whose API refuses is the exact thing
  // capabilities exist to prevent.
  it('falls back to the service store for a runtime driver that keeps nothing', () => {
    expect(DeploymentService.getInstance().envVarStore()).toBeDefined();
  });

  it('prefers the driver-s own store when it has one', () => {
    const own = {
      upsert: vi.fn(),
      keys: vi.fn(),
      list: vi.fn(),
      get: vi.fn(),
      remove: vi.fn(),
    };
    active.provider = { ...mockProvider, envVars: own };

    expect(DeploymentService.getInstance().envVarStore()).toBe(own);
  });

  it('refuses by name for a driver that cannot hold them at all', () => {
    active.provider = { ...mockProvider, capabilities: () => ({ envVars: 'none' }) };

    expect(() => DeploymentService.getInstance().envVarStore()).toThrow(
      'does not support environment variables'
    );
  });
});

describe('environment variables follow the row, not the default driver', () => {
  // Both review bots flagged this, and they were right: the start path resolves the row's
  // driver for the build but applyEnvVars read the *active* one. On an instance where the
  // default has since changed, a Vercel deployment's values were persisted locally and the
  // Vercel project got none — or the inverse, sending them to an API that does not own the
  // deployment.
  it('sends them to the driver that owns the deployment', async () => {
    mockPool.query
      // getDeploymentById
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'row-1',
            provider: 'vercel',
            status: 'WAITING',
            providerDeploymentId: null,
            url: null,
            metadata: { uploadMode: 'direct' },
          },
        ],
      })
      // getDeploymentFiles
      .mockResolvedValueOnce({
        rows: [
          {
            fileId: 'f1',
            path: 'index.html',
            sha: 'a'.repeat(40),
            size: 12,
            uploadedAt: new Date().toISOString(),
          },
        ],
      })
      .mockResolvedValue({ rows: [] });
    mockClient.query.mockResolvedValue({ rows: [{ id: 'row-1', status: 'READY' }] });

    await DeploymentService.getInstance()
      .startDeployment('row-1', { envVars: [{ key: 'API_URL', value: 'https://api.test' }] })
      .catch(() => undefined);

    const other = active.other as { envVars: { upsert: ReturnType<typeof vi.fn> } };
    expect(other.envVars.upsert).toHaveBeenCalledWith([
      { key: 'API_URL', value: 'https://api.test' },
    ]);
  });
});

describe('the service-backed env-var store', () => {
  // `type` is required by deploymentEnvVarSchema, so a store that omitted it produced a
  // response the dashboard cannot parse. `encrypted` is the truth: these live in the secret
  // store.
  it('reports the type the wire schema requires', async () => {
    const secrets = await import('../../src/services/secrets/secret.service.js');
    vi.spyOn(secrets.SecretService.getInstance(), 'getSecretByKey').mockResolvedValue(
      JSON.stringify([{ key: 'API_URL', value: 'https://api.test' }])
    );

    const listed = await DeploymentService.getInstance().envVarStore().list();

    expect(listed).toEqual([{ id: 'API_URL', key: 'API_URL', type: 'encrypted' }]);
  });

  // Read-modify-write against one secret row: two requests at once would each write their
  // own view and the later would drop the other's variable.
  it('serializes concurrent writes so neither loses the other', async () => {
    const secrets = await import('../../src/services/secrets/secret.service.js');
    let stored: Array<{ key: string; value: string }> = [];
    vi.spyOn(secrets.SecretService.getInstance(), 'getSecretByKey').mockImplementation(
      () => Promise.resolve(JSON.stringify(stored)) as never
    );
    vi.spyOn(secrets.SecretService.getInstance(), 'updateSecretByKey').mockImplementation(((
      _key: string,
      patch: { value: string }
    ) => {
      stored = JSON.parse(patch.value) as Array<{ key: string; value: string }>;
      return Promise.resolve(undefined);
    }) as never);

    const store = DeploymentService.getInstance().envVarStore();
    await Promise.all([
      store.upsert([{ key: 'FIRST', value: '1' }]),
      store.upsert([{ key: 'SECOND', value: '2' }]),
    ]);

    expect(stored.map((envVar) => envVar.key).sort()).toEqual(['FIRST', 'SECOND']);
  });
});

describe('DeploymentService.updateDeploymentFromWebhook', () => {
  const savedAppKey = process.env.APP_KEY;
  afterAll(() => {
    if (savedAppKey === undefined) {
      delete process.env.APP_KEY;
    } else {
      process.env.APP_KEY = savedAppKey;
    }
  });

  // Only Vercel sends webhooks, so the row this matches is always a Vercel row. Reading its
  // URL through the *current default* meant that on an instance since switched to Docker,
  // every webhook overwrote the stable insforge.site address with the transient Vercel
  // hostname — a URL that changes on each deploy.
  it('computes the URL through the vercel driver even when docker is the default', async () => {
    process.env.APP_KEY = 'appkey01';
    mockPool.query.mockResolvedValue({
      rows: [{ id: 'row-1', provider: 'vercel', status: 'READY', url: null, metadata: {} }],
    });

    await DeploymentService.getInstance().updateDeploymentFromWebhook(
      'dpl_vercel_1',
      'READY',
      'https://transient-abc123.vercel.app',
      {}
    );

    const update = mockPool.query.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE deployments.runs')
    );
    expect(update?.[1]?.[1]).toBe('https://appkey01.insforge.site');
  });

  // An instance that has moved to Docker can still receive a webhook for a deployment made
  // before the switch. Refusing it would leave that row stuck at its old status forever, so
  // the status still lands and the URL is simply left alone.
  it('still records the status when the vercel driver is gone, without touching the URL', async () => {
    process.env.APP_KEY = 'appkey01';
    active.other = undefined;
    mockPool.query.mockResolvedValue({
      rows: [{ id: 'row-1', provider: 'vercel', status: 'READY', url: null, metadata: {} }],
    });

    await DeploymentService.getInstance().updateDeploymentFromWebhook(
      'dpl_vercel_1',
      'READY',
      'https://transient-abc123.vercel.app',
      {}
    );

    const update = mockPool.query.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE deployments.runs')
    );
    expect(update?.[1]?.[0]).toBe('READY');
    expect(update?.[1]?.[1]).toBeNull();
  });
});

describe('a deploy that fails at the provider', () => {
  function stageStartableRow() {
    mockPool.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'row-1',
            provider: 'docker',
            status: 'WAITING',
            providerDeploymentId: null,
            url: null,
            metadata: { uploadMode: 'direct' },
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            fileId: 'f1',
            path: 'index.html',
            sha: 'a'.repeat(40),
            size: 12,
            uploadedAt: new Date().toISOString(),
          },
        ],
      })
      .mockResolvedValue({ rows: [] });
  }

  // The row is set to UPLOADING on the way in. Rethrowing an AppError without touching it
  // left the run mid-flight forever, and threw away the message — which for the Docker
  // driver is where the build output lives.
  it('records ERROR and keeps the message when the driver fails', async () => {
    stageStartableRow();
    active.provider = {
      ...mockProvider,
      uploadFiles: vi.fn().mockResolvedValue([]),
      createDeploymentWithFiles: vi
        .fn()
        .mockRejectedValue(new AppError('build failed\n\nerror TS2322', 502, 'UPSTREAM_FAILURE')),
    };

    await expect(DeploymentService.getInstance().startDeployment('row-1')).rejects.toThrow(
      'error TS2322'
    );

    const errorWrite = mockPool.query.mock.calls
      .concat(mockClient.query.mock.calls)
      .find(([, params]) => JSON.stringify(params ?? []).includes('error TS2322'));
    expect(errorWrite).toBeDefined();
  });

  // Recording ERROR must not make the failure permanent: a transient upstream 502 would then
  // be unrecoverable, where before it left the row UPLOADING and retryable by accident.
  it('lets a failed deployment be started again', async () => {
    mockPool.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'row-1',
            provider: 'docker',
            status: 'ERROR',
            providerDeploymentId: null,
            url: null,
            metadata: { uploadMode: 'direct' },
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            fileId: 'f1',
            path: 'index.html',
            sha: 'a'.repeat(40),
            size: 12,
            uploadedAt: new Date().toISOString(),
          },
        ],
      })
      .mockResolvedValue({ rows: [] });
    const createDeploymentWithFiles = vi.fn().mockResolvedValue({
      id: 'container-new',
      url: null,
      state: 'running',
      readyState: 'READY',
      name: 'insforge-site-local:abc',
      createdAt: new Date(),
    });
    active.provider = {
      ...mockProvider,
      uploadFiles: vi.fn().mockResolvedValue([]),
      createDeploymentWithFiles,
    };
    mockClient.query.mockResolvedValue({ rows: [{ id: 'row-1', status: 'READY' }] });

    await DeploymentService.getInstance().startDeployment('row-1');

    expect(createDeploymentWithFiles).toHaveBeenCalled();
  });

  // A 4xx is the caller's own request — files not uploaded, no build command. Marking the row
  // ERROR would make the corrected retry fail with "not ready to start".
  it('leaves the row retryable when the driver refuses the request', async () => {
    stageStartableRow();
    active.provider = {
      ...mockProvider,
      uploadFiles: vi.fn().mockResolvedValue([]),
      createDeploymentWithFiles: vi
        .fn()
        .mockRejectedValue(new AppError('needs a build command', 400, 'INVALID_INPUT')),
    };

    await expect(DeploymentService.getInstance().startDeployment('row-1')).rejects.toThrow(
      'needs a build command'
    );

    const statusWrites = mockPool.query.mock.calls
      .concat(mockClient.query.mock.calls)
      .filter(([sql]) => String(sql).includes('SET status'))
      .map(([, params]) => JSON.stringify(params ?? []));
    expect(statusWrites.some((params) => params.includes('ERROR'))).toBe(false);
  });
});

describe('errors from the deployment provider', () => {
  // `UpstreamError` carries the status the provider returned. Vercel answers 401 when the
  // stored token is stale — and the dashboard client treats any 401 as a dead session, so it
  // clears tokens and logs the admin out. Before this PR added a rethrow here, everything
  // became a 500; the leak is new, so it stops here.
  it('does not pass an upstream 401 through as our own', async () => {
    active.provider = {
      ...mockProvider,
      domains: {
        list: vi.fn().mockRejectedValue(new UpstreamError({ response: { status: 401 } }, 'nope')),
        url: vi.fn(),
        add: vi.fn(),
        remove: vi.fn(),
        verify: vi.fn(),
        get: vi.fn(),
        config: vi.fn(),
      },
    };

    await expect(DeploymentService.getInstance().listCustomDomains()).rejects.toThrow(
      expect.objectContaining({ statusCode: 502 })
    );
  });

  // A driver that owns no domains still says so with its own 400.
  it('keeps a driver refusal as the 400 it is', async () => {
    active.provider = { ...mockProvider, domains: undefined };

    await expect(DeploymentService.getInstance().listCustomDomains()).rejects.toThrow(
      expect.objectContaining({ statusCode: 400 })
    );
  });
});

describe('DeploymentService.getMetadata with no driver configured', () => {
  // A documented 200 endpoint, fetched on the dashboard home. Reading `this.provider`
  // unguarded turned it into a 503 for any instance without a sites driver — the deployment
  // id and default URL come from the row and need no driver at all.
  it('answers with nulls rather than 503', async () => {
    noDriver.configured = false;
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    await expect(DeploymentService.getInstance().getMetadata()).resolves.toEqual({
      currentDeploymentId: null,
      defaultDomainUrl: null,
      customDomainUrl: null,
    });
  });
});

describe('the deploy-path environment write', () => {
  // The deploy write went straight to the secret row while the management API went through a
  // queue, so a dashboard save racing a deploy lost one of the two. Asserted on the outcome
  // rather than on overlap: one serialized write reads the row twice, so a naive "two reads
  // in flight" check flags itself.
  it('shares the queue with the management API, so neither write is lost', async () => {
    const secrets = await import('../../src/services/secrets/secret.service.js');
    let stored: Array<{ key: string; value: string }> = [];
    vi.spyOn(secrets.SecretService.getInstance(), 'getSecretByKey').mockImplementation((() =>
      Promise.resolve(JSON.stringify(stored))) as never);
    // A write that takes a moment, which is what makes the ordering observable at all: with an
    // instantly-resolving mock both orderings produce the same result, and the test cannot tell
    // a queued write from an unqueued one.
    vi.spyOn(secrets.SecretService.getInstance(), 'updateSecretByKey').mockImplementation(
      ((_key: string, patch: { value: string }) =>
        new Promise((resolve) =>
          setTimeout(() => {
            stored = JSON.parse(patch.value) as Array<{ key: string; value: string }>;
            resolve(undefined);
          }, 10)
        )) as never
    );

    const service = DeploymentService.getInstance();
    const store = service.envVarStore();
    // Deploy queued first, dashboard second. The deploy replaces the whole set on purpose,
    // so the only question is whether the dashboard's read-modify-write sees that write or a
    // snapshot from before it. Unqueued, its `load()` runs immediately, sees an empty set, and
    // its write drops the deploy's variable.
    await Promise.all([
      (
        service as unknown as { applyEnvVars: (v: unknown, p: unknown) => Promise<unknown> }
      ).applyEnvVars([{ key: 'FROM_DEPLOY', value: '2' }], active.provider),
      store.upsert([{ key: 'FROM_DASHBOARD', value: '1' }]),
    ]);

    expect(stored.map((envVar) => envVar.key).sort()).toEqual(['FROM_DASHBOARD', 'FROM_DEPLOY']);
  });
});

describe('a zip that expands past the size limit', () => {
  // The upload is capped, but a zip is compressed: the cap bounds the archive, not what it
  // expands to. Every entry is read into memory, and the Docker driver then builds a second
  // full copy as a tar.
  it('is refused before anything is allocated', async () => {
    const service = DeploymentService.getInstance() as unknown as {
      extractFilesFromZip: (buffer: Buffer) => unknown;
      getMaxDeploymentTotalBytes: () => number;
    };
    const limit = service.getMaxDeploymentTotalBytes();
    const AdmZip = (await import('adm-zip')).default;
    const zip = new AdmZip();
    // Highly compressible, so the archive stays small while the contents do not.
    zip.addFile('big.bin', Buffer.alloc(limit + 1024, 0));

    expect(() => service.extractFilesFromZip(zip.toBuffer())).toThrow(/expands/);
  });

  it('lets an ordinary archive through', async () => {
    const service = DeploymentService.getInstance() as unknown as {
      extractFilesFromZip: (buffer: Buffer) => Array<{ path: string }>;
    };
    const AdmZip = (await import('adm-zip')).default;
    const zip = new AdmZip();
    zip.addFile('index.html', Buffer.from('<h1>hi</h1>'));

    expect(service.extractFilesFromZip(zip.toBuffer()).map((f) => f.path)).toEqual(['index.html']);
  });
});

describe('providerFor when the default driver is unusable', () => {
  // The getter throws when the *default* is unconfigured, which stranded every row-scoped
  // operation — rollback and logs for a perfectly healthy Docker deployment — because Vercel
  // credentials had gone stale.
  it('still reaches the driver the row names', async () => {
    noDriver.configured = false;
    mockPool.query.mockResolvedValueOnce({ rows: [rowFor('row-1', 'server-live')] });
    mockProvider.runtimeLogs.mockResolvedValue({ lines: [], nextToken: null });

    await expect(DeploymentService.getInstance().getRuntimeLogs('row-1')).resolves.toEqual({
      lines: [],
      nextToken: null,
    });
  });
});
