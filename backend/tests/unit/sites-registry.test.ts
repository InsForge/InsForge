import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { ERROR_CODES } from '@insforge/shared-schemas';

const configMock = {
  cloud: { projectId: undefined as string | undefined, apiHost: 'https://cloud.test' },
  app: { jwtSecret: 's'.repeat(32), logLevel: 'error' },
  server: { logsDir: '/tmp/insforge-sites-registry-test-logs' },
  deployments: {
    vercelToken: undefined as string | undefined,
    vercelTeamId: undefined as string | undefined,
    vercelProjectId: undefined as string | undefined,
  },
  storage: { s3Bucket: undefined, appKey: undefined },
};
vi.mock('@/infra/config/app.config.js', () => ({ config: configMock, appConfig: configMock }));

const {
  buildSitesRegistry,
  getSitesMetadata,
  isAnySitesProviderConfigured,
  requireDomainStore,
  requireEnvVarStore,
  selectSitesProvider,
} = await import('@/services/deployments/sites-registry.js');

const savedProfile = process.env.AWS_INSTANCE_PROFILE_NAME;
const savedRequested = process.env.SITES_PROVIDER;

function configureVercel(): void {
  configMock.deployments.vercelToken = 'vercel-token';
  configMock.deployments.vercelTeamId = 'team_1';
  configMock.deployments.vercelProjectId = 'prj_1';
}

beforeEach(() => {
  delete process.env.AWS_INSTANCE_PROFILE_NAME;
  delete process.env.SITES_PROVIDER;
  configMock.deployments.vercelToken = undefined;
  configMock.deployments.vercelTeamId = undefined;
  configMock.deployments.vercelProjectId = undefined;
});

afterAll(() => {
  if (savedProfile === undefined) {
    delete process.env.AWS_INSTANCE_PROFILE_NAME;
  } else {
    process.env.AWS_INSTANCE_PROFILE_NAME = savedProfile;
  }
  if (savedRequested === undefined) {
    delete process.env.SITES_PROVIDER;
  } else {
    process.env.SITES_PROVIDER = savedRequested;
  }
});

describe('buildSitesRegistry', () => {
  it('registers the Vercel driver when credentials are present', () => {
    configureVercel();

    const registry = buildSitesRegistry();

    expect([...registry.providers.keys()]).toEqual(['vercel']);
    expect(registry.defaultProvider).toBe('vercel');
    expect(selectSitesProvider().name).toBe('vercel');
  });

  it('throws with the reason when nothing is configured', () => {
    expect(() => buildSitesRegistry()).toThrow(
      expect.objectContaining({ code: ERROR_CODES.DEPLOYMENT_NOT_CONFIGURED, statusCode: 503 })
    );
    expect(() => buildSitesRegistry()).toThrow('No sites provider is configured');
  });

  // A named driver that cannot run must fail here rather than on the first deploy, and
  // the message has to name what is missing — the operator set the variable on purpose.
  it('throws when the requested driver is unusable, naming the missing credentials', () => {
    process.env.SITES_PROVIDER = 'vercel';

    expect(() => buildSitesRegistry()).toThrow('SITES_PROVIDER=vercel');
    expect(() => buildSitesRegistry()).toThrow(
      expect.objectContaining({ nextActions: expect.stringContaining('VERCEL_TOKEN') })
    );
  });

  it('disables sites entirely on off', () => {
    configureVercel();
    process.env.SITES_PROVIDER = 'off';

    expect(() => buildSitesRegistry()).toThrow('Sites are disabled');
  });

  it('rejects an unknown value instead of silently falling back', () => {
    configureVercel();
    process.env.SITES_PROVIDER = 'netlify';

    expect(() => buildSitesRegistry()).toThrow('Unknown SITES_PROVIDER "netlify"');
  });

  it('ignores case and surrounding whitespace', () => {
    configureVercel();
    process.env.SITES_PROVIDER = '  VERCEL ';

    expect(buildSitesRegistry().defaultProvider).toBe('vercel');
  });
});

describe('isAnySitesProviderConfigured', () => {
  // Callers use this to *report* availability, so it has to answer rather than throw.
  it('answers false instead of throwing when unconfigured', () => {
    expect(isAnySitesProviderConfigured()).toBe(false);

    configureVercel();
    expect(isAnySitesProviderConfigured()).toBe(true);
  });
});

describe('getSitesMetadata', () => {
  it('is absent when no driver can serve a deployment', () => {
    expect(getSitesMetadata()).toBeUndefined();
  });

  // Published to clients, so the shape is the contract: Vercel reports no build logs and
  // no rollback because neither exists in this codebase.
  it('publishes the active driver capabilities', () => {
    configureVercel();

    expect(getSitesMetadata()).toEqual({
      defaultProvider: 'vercel',
      providers: {
        vercel: {
          envVars: 'runtime',
          customDomains: true,
          slug: true,
          rollback: false,
          buildLogs: false,
          frameworkDetection: true,
          ingressModes: ['host'],
          defaultIngress: 'host',
        },
      },
    });
  });
});

describe('capability stores', () => {
  it('hands back the stores a driver has', () => {
    configureVercel();

    expect(requireEnvVarStore()).toBeDefined();
    expect(requireDomainStore()).toBeDefined();
  });

  // Reaching a store on an instance with no driver must not read as "unsupported" —
  // nothing is configured, which is a different fix.
  it('reports not-configured rather than unsupported when there is no driver', () => {
    expect(() => requireEnvVarStore()).toThrow('No sites provider is configured');
  });
});
