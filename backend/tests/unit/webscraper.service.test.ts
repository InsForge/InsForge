import { describe, it, expect, vi, beforeEach } from 'vitest';

// `webscraper.service.ts` imports LocalWebscraperProvider and ApifyConfigService
// eagerly, which transitively pull in SecretService -> DatabaseManager -> logger.
// logger.ts reads `appConfig.server.logsDir` and `appConfig.app.logLevel` at module
// top-level (not lazily), so the mocked config needs those fields too or the import
// itself throws before any test body runs — this is unrelated to the cloud/local
// resolution behavior under test, so the values are arbitrary placeholders.
const configMock = {
  cloud: { projectId: undefined as string | undefined, apiHost: 'https://x' },
  app: { jwtSecret: 's'.repeat(32), logLevel: 'error' },
  server: { logsDir: '/tmp/insforge-webscraper-test-logs' },
};
vi.mock('../../src/infra/config/app.config', () => ({ config: configMock, appConfig: configMock }));

const { WebscraperService } = await import('../../src/services/webscraper/webscraper.service');

function makeProviders() {
  const make = (tag: string) => ({
    getConnection: vi.fn().mockResolvedValue({ tag }),
    disconnect: vi.fn(),
    getToken: vi.fn(),
    getRuns: vi.fn(),
    getActors: vi.fn(),
    getDatasets: vi.fn(),
    getLatestData: vi.fn(),
  });
  return { cloud: make('cloud'), local: make('local') };
}

describe('WebscraperService provider resolution', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses the cloud provider when a project id is configured', async () => {
    configMock.cloud.projectId = '77777777-7777-7777-7777-777777777777';
    const { cloud, local } = makeProviders();
    const service = new WebscraperService(cloud as never, local as never);

    await expect(service.getApifyConnection()).resolves.toEqual({ tag: 'cloud' });
    expect(local.getConnection).not.toHaveBeenCalled();
  });

  it('uses the local provider when no project id is configured', async () => {
    configMock.cloud.projectId = undefined;
    const { cloud, local } = makeProviders();
    const service = new WebscraperService(cloud as never, local as never);

    await expect(service.getApifyConnection()).resolves.toEqual({ tag: 'local' });
    expect(cloud.getConnection).not.toHaveBeenCalled();
  });

  it('treats the literal project id "local" as self-hosted', async () => {
    configMock.cloud.projectId = 'local';
    const { cloud, local } = makeProviders();
    const service = new WebscraperService(cloud as never, local as never);

    await expect(service.getApifyConnection()).resolves.toEqual({ tag: 'local' });
  });

  it('re-resolves per call so a config change does not need a restart', async () => {
    const { cloud, local } = makeProviders();
    const service = new WebscraperService(cloud as never, local as never);

    configMock.cloud.projectId = undefined;
    await service.getApifyConnection();
    configMock.cloud.projectId = '77777777-7777-7777-7777-777777777777';
    await service.getApifyConnection();

    expect(local.getConnection).toHaveBeenCalledTimes(1);
    expect(cloud.getConnection).toHaveBeenCalledTimes(1);
  });
});
