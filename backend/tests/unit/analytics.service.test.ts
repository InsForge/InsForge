import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ERROR_CODES } from '@insforge/shared-schemas';

const cloudConfig = vi.hoisted(() => ({ projectId: undefined as string | undefined }));
vi.mock('../../src/infra/config/app.config.js', () => ({
  appConfig: { cloud: cloudConfig, app: { jwtSecret: 's'.repeat(32) } },
  config: { cloud: cloudConfig },
}));
vi.mock('../../src/utils/logger.js', () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const { AnalyticsService } = await import('../../src/services/analytics/analytics.service.js');

const PERSONAL_KEY = 'phx_key';

function authError(status: number) {
  const err = new Error(`Request failed with status code ${status}`) as Error & {
    response: { status: number };
  };
  err.response = { status };
  return err;
}

function makeDeps(
  projects: { id: string | number; name: string; api_token?: string }[] = [
    { id: 4242, name: 'Web', api_token: 'phc_pub' },
  ]
) {
  const api = {
    listOrganizations: vi.fn(async () => [{ id: 'org-1', name: 'Acme' }]),
    listProjects: vi.fn(async () => projects),
  };
  const config = {
    getConfig: vi.fn(async () => ({ personalApiKey: { configured: true, maskedKey: 'ph••' } })),
    setConnection: vi.fn(async () => ({
      personalApiKey: { configured: true, maskedKey: 'ph••' },
    })),
  };
  const cloud = { getConnection: vi.fn(async () => null) };
  const local = { getConnection: vi.fn(async () => null) };
  return { api, config, cloud, local };
}

function makeService(deps = makeDeps()) {
  return {
    service: new AnalyticsService(
      deps.cloud as never,
      deps.local as never,
      deps.config as never,
      deps.api as never
    ),
    ...deps,
  };
}

describe('AnalyticsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cloudConfig.projectId = undefined;
  });

  describe('provider selection', () => {
    it('uses the local provider when PROJECT_ID is absent', async () => {
      cloudConfig.projectId = undefined;
      const { service, local, cloud } = makeService();

      await service.getConnection();
      expect(local.getConnection).toHaveBeenCalledOnce();
      expect(cloud.getConnection).not.toHaveBeenCalled();
    });

    it("treats the 'local' placeholder as self-hosted", async () => {
      cloudConfig.projectId = 'local';
      const { service, local } = makeService();

      await service.getConnection();
      expect(local.getConnection).toHaveBeenCalledOnce();
    });

    it('uses the cloud provider when a real PROJECT_ID is set', async () => {
      cloudConfig.projectId = '77777777-7777-7777-7777-777777777777';
      const { service, cloud, local } = makeService();

      await service.getConnection();
      expect(cloud.getConnection).toHaveBeenCalledOnce();
      expect(local.getConnection).not.toHaveBeenCalled();
    });
  });

  describe('connect', () => {
    it('discovers project id and phc_ key from the personal key alone', async () => {
      const { service, config, api } = makeService();

      await service.connect({ personalApiKey: PERSONAL_KEY, region: 'US' });

      expect(api.listOrganizations).toHaveBeenCalledWith({
        personalApiKey: PERSONAL_KEY,
        host: 'https://us.posthog.com',
      });
      expect(config.setConnection).toHaveBeenCalledWith({
        personalApiKey: PERSONAL_KEY,
        host: 'https://us.posthog.com',
        posthogProjectId: '4242',
        apiKey: 'phc_pub',
        organizationName: 'Acme',
        projectName: 'Web',
      });
    });

    it('maps region EU to the EU host', async () => {
      const { service, config } = makeService();

      await service.connect({ personalApiKey: PERSONAL_KEY, region: 'EU' });

      expect(config.setConnection.mock.lastCall?.[0]).toMatchObject({
        host: 'https://eu.posthog.com',
      });
    });

    it('refuses to guess when the key sees several projects', async () => {
      const { service, config } = makeService(
        makeDeps([
          { id: 1, name: 'Web' },
          { id: 2, name: 'Mobile' },
        ])
      );

      await expect(
        service.connect({ personalApiKey: PERSONAL_KEY, region: 'US' })
      ).rejects.toMatchObject({ statusCode: 400, code: ERROR_CODES.INVALID_INPUT });
      // Naming the options is what makes the error actionable.
      await expect(service.connect({ personalApiKey: PERSONAL_KEY, region: 'US' })).rejects.toThrow(
        /1 \(Web\), 2 \(Mobile\)/
      );
      expect(config.setConnection).not.toHaveBeenCalled();
    });

    it('honours an explicit project id', async () => {
      const { service, config } = makeService(
        makeDeps([
          { id: 1, name: 'Web', api_token: 'phc_a' },
          { id: 2, name: 'Mobile', api_token: 'phc_b' },
        ])
      );

      await service.connect({ personalApiKey: PERSONAL_KEY, region: 'US', posthogProjectId: '2' });

      expect(config.setConnection.mock.lastCall?.[0]).toMatchObject({
        posthogProjectId: '2',
        projectName: 'Mobile',
        apiKey: 'phc_b',
      });
    });

    it('rejects a project id the key cannot see', async () => {
      const { service } = makeService();

      await expect(
        service.connect({ personalApiKey: PERSONAL_KEY, region: 'US', posthogProjectId: '999' })
      ).rejects.toThrow(/not visible to this key/);
    });

    it('rejects a key with access to no projects', async () => {
      const { service } = makeService(makeDeps([]));

      await expect(service.connect({ personalApiKey: PERSONAL_KEY, region: 'US' })).rejects.toThrow(
        /does not have access to any project/
      );
    });

    it('stores an empty phc_ when PostHog omits api_token', async () => {
      const { service, config } = makeService(makeDeps([{ id: 7, name: 'NoToken' }]));

      await service.connect({ personalApiKey: PERSONAL_KEY, region: 'US' });
      expect(config.setConnection.mock.lastCall?.[0]).toMatchObject({ apiKey: '' });
    });

    it('trims the pasted key before use', async () => {
      const { service, api } = makeService();

      await service.connect({ personalApiKey: `  ${PERSONAL_KEY}\n`, region: 'US' });
      expect(api.listOrganizations.mock.lastCall?.[0]).toMatchObject({
        personalApiKey: PERSONAL_KEY,
      });
    });

    // A rejected key is the user's mistake, not an outage — 400 so the connect
    // dialog can show it inline instead of rendering an upstream-failure banner.
    it.each([401, 403])('reports a rejected key (%i) as 400 with a scope hint', async (status) => {
      const deps = makeDeps();
      deps.api.listOrganizations.mockRejectedValue(authError(status));
      const { service, config } = makeService(deps);

      await expect(
        service.connect({ personalApiKey: PERSONAL_KEY, region: 'US' })
      ).rejects.toMatchObject({ statusCode: 400, code: ERROR_CODES.INVALID_INPUT });
      await expect(service.connect({ personalApiKey: PERSONAL_KEY, region: 'US' })).rejects.toThrow(
        /scopes/
      );
      expect(config.setConnection).not.toHaveBeenCalled();
    });

    it('reports an unreachable PostHog as 502', async () => {
      const deps = makeDeps();
      deps.api.listOrganizations.mockRejectedValue(new Error('ECONNREFUSED'));
      const { service } = makeService(deps);

      await expect(
        service.connect({ personalApiKey: PERSONAL_KEY, region: 'US' })
      ).rejects.toMatchObject({ statusCode: 502, code: ERROR_CODES.UPSTREAM_FAILURE });
    });

    it('nothing is written when discovery fails', async () => {
      const deps = makeDeps();
      deps.api.listProjects.mockRejectedValue(authError(401));
      const { service, config } = makeService(deps);

      await expect(
        service.connect({ personalApiKey: PERSONAL_KEY, region: 'US' })
      ).rejects.toThrow();
      expect(config.setConnection).not.toHaveBeenCalled();
    });
  });

  describe('host validation', () => {
    it('rejects a plaintext PostHog host', async () => {
      const { isValidPosthogHost } =
        await import('../../src/services/analytics/posthog-api.service.js');
      // Only reachable via a hand-edited row — the region map never produces
      // http — but this is the check that stops the key going out in the clear.
      expect(isValidPosthogHost('http://us.posthog.com')).toBe(false);
      expect(isValidPosthogHost('https://us.posthog.com')).toBe(true);
      expect(isValidPosthogHost('https://evil.example.com')).toBe(false);
    });
  });

  describe('listAvailableProjects', () => {
    it('returns the picker options without storing anything', async () => {
      const { service, config } = makeService(
        makeDeps([
          { id: 1, name: 'Web', api_token: 'phc_a' },
          { id: 2, name: 'Mobile', api_token: 'phc_b' },
        ])
      );

      const projects = await service.listAvailableProjects({
        personalApiKey: PERSONAL_KEY,
        region: 'US',
      });

      expect(projects).toEqual([
        expect.objectContaining({ posthogProjectId: '1', name: 'Web', organizationName: 'Acme' }),
        expect.objectContaining({ posthogProjectId: '2', name: 'Mobile' }),
      ]);
      expect(config.setConnection).not.toHaveBeenCalled();
    });
  });
});
