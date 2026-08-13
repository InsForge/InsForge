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
  // A path that does not exist, so the Docker driver stays unregistered unless a test
  // points this at a real file. Reading the host's real socket would make these results
  // depend on whether the developer runs Docker Desktop.
  docker: {
    socketPath: '/nonexistent/test.sock',
    bindAddress: '127.0.0.1',
    defaultIngress: 'none',
  },
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

/** Any existing file passes the socket probe — existsSync is all the driver checks. */
function mountDockerSocket(): void {
  configMock.docker.socketPath = process.execPath;
}

function configureVercel(): void {
  configMock.deployments.vercelToken = 'vercel-token';
  configMock.deployments.vercelTeamId = 'team_1';
  configMock.deployments.vercelProjectId = 'prj_1';
}

beforeEach(() => {
  configMock.docker.socketPath = '/nonexistent/test.sock';
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

  // Mounting the socket is the opt-in, so the driver appears without being named.
  it('registers Docker when the socket is present', () => {
    mountDockerSocket();

    const registry = buildSitesRegistry();

    expect([...registry.providers.keys()]).toEqual(['docker']);
    expect(registry.defaultProvider).toBe('docker');
  });

  // An instance that mounts the socket for compute must not silently move its site to a
  // new driver on upgrade.
  it('keeps Vercel as the default when both are available', () => {
    configureVercel();
    mountDockerSocket();

    const registry = buildSitesRegistry();

    expect([...registry.providers.keys()]).toEqual(['vercel', 'docker']);
    expect(registry.defaultProvider).toBe('vercel');
  });

  it('honours SITES_PROVIDER=docker when both are available', () => {
    configureVercel();
    mountDockerSocket();
    process.env.SITES_PROVIDER = 'docker';

    expect(buildSitesRegistry().defaultProvider).toBe('docker');
  });

  // Running customer containers on shared infrastructure is a tenant escape, so the
  // driver fails closed on cloud whether or not a socket is reachable — and the message
  // must not send the operator chasing a socket mount that is not the problem.
  it('refuses Docker on a cloud-managed project, naming the real reason', () => {
    process.env.AWS_INSTANCE_PROFILE_NAME = 'EC2-role';
    mountDockerSocket();
    process.env.SITES_PROVIDER = 'docker';

    expect(() => buildSitesRegistry()).toThrow('self-host only');
    expect(() => buildSitesRegistry()).toThrow(
      expect.objectContaining({ statusCode: 400, code: ERROR_CODES.DEPLOYMENT_NOT_CONFIGURED })
    );
  });

  it('names the socket path when Docker was asked for and is absent', () => {
    process.env.SITES_PROVIDER = 'docker';

    expect(() => buildSitesRegistry()).toThrow('/nonexistent/test.sock');
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
  // Values reach the build as build args and are baked in, hence build-only rather than a
  // store. rollback and buildLogs are true here and false for Vercel — every deployment is
  // its own image, and the classic builder streams output we keep.
  it('publishes what the Docker driver can actually do', () => {
    mountDockerSocket();

    expect(getSitesMetadata()?.providers.docker).toEqual({
      envVars: 'build-only',
      customDomains: false,
      slug: false,
      rollback: true,
      buildLogs: true,
      frameworkDetection: false,
      ingressModes: ['port', 'host'],
      defaultIngress: 'port',
    });
  });

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
