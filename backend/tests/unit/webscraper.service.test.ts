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
    // Local-only: the cloud provider has no token to verify (OAuth owns it).
    verifyToken: vi.fn().mockResolvedValue(undefined),
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

describe('WebscraperService.setApifyToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configMock.cloud.projectId = undefined;
  });

  // The point of verifying first is that Apify — not InsForge — decides whether
  // the pasted string is a usable token. Storing it before asking would leave a
  // dead credential behind that 401s on every later read, so the order is the
  // behaviour, not an implementation detail.
  it('verifies the token with the injected local provider before storing it', async () => {
    const calls: string[] = [];
    const { cloud, local } = makeProviders();
    local.verifyToken.mockImplementation(async () => {
      calls.push('verify');
    });
    const config = {
      setToken: vi.fn(async () => {
        calls.push('store');
        return { token: { configured: true, maskedKey: 'apify_ap••••••••7890' } };
      }),
    };
    const service = new WebscraperService(cloud as never, local as never, config as never);

    await service.setApifyToken('apify_api_tok1234567890');

    expect(local.verifyToken).toHaveBeenCalledWith('apify_api_tok1234567890');
    expect(calls).toEqual(['verify', 'store']);
  });

  it('does not store a token the local provider rejects', async () => {
    const { cloud, local } = makeProviders();
    local.verifyToken.mockRejectedValue(new Error('Apify rejected this API token.'));
    const config = { setToken: vi.fn() };
    const service = new WebscraperService(cloud as never, local as never, config as never);

    await expect(service.setApifyToken('apify_api_bogus123456789')).rejects.toThrow(
      'Apify rejected this API token.'
    );
    expect(config.setToken).not.toHaveBeenCalled();
  });

  // setToken() trims before persisting, so verifying the untrimmed value would
  // reject a token over whitespace that never reaches the store. The CLI
  // forwards `--token` verbatim and `$(cat token.txt)` carries a newline.
  it('verifies and stores the same trimmed token', async () => {
    const { cloud, local } = makeProviders();
    const config = { setToken: vi.fn() };
    const service = new WebscraperService(cloud as never, local as never, config as never);

    await service.setApifyToken('  apify_api_tok1234567890\n');

    expect(local.verifyToken).toHaveBeenCalledWith('apify_api_tok1234567890');
    expect(config.setToken).toHaveBeenCalledWith('apify_api_tok1234567890');
  });
});
