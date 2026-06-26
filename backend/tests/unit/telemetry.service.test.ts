import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Response } from 'node-fetch';
import { TelemetryConfig, TelemetryService } from '../../src/services/telemetry/telemetry.service';
import logger from '../../src/utils/logger';

type FetchFunction = ConstructorParameters<typeof TelemetryService>[1];

const tempRoots: string[] = [];
const ciEnvKeys = ['CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'BUILDKITE', 'CIRCLECI', 'JENKINS_URL'];
let savedEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  savedEnv = { ...process.env };
});

afterEach(() => {
  process.env = savedEnv;
  vi.restoreAllMocks();

  for (const tempRoot of tempRoots.splice(0)) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

function makeConfig(overrides: Partial<TelemetryConfig> = {}): TelemetryConfig {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'insforge-telemetry-'));
  tempRoots.push(tempRoot);

  return {
    disabled: false,
    endpoint: 'https://telemetry.test/v1/events',
    posthogApiKey: 'phc_test',
    installationIdPath: path.join(tempRoot, '.insforge-installation-id'),
    heartbeatIntervalMs: 60_000,
    requestTimeoutMs: 500,
    ...overrides,
  };
}

function makeFetchMock(status = 204): FetchFunction {
  return vi.fn(async () => new Response(null, { status })) as FetchFunction;
}

function clearRuntimeEnvironment(): void {
  for (const key of ciEnvKeys) {
    delete process.env[key];
  }

  delete process.env.NODE_ENV;
  delete process.env.npm_lifecycle_event;
}

function getPostedBody(fetchMock: FetchFunction, callIndex = 0): Record<string, unknown> {
  const call = vi.mocked(fetchMock).mock.calls[callIndex];
  expect(call).toBeDefined();
  const init = call?.[1];
  expect(init).toBeDefined();
  expect(typeof init).toBe('object');

  const body = (init as { body?: unknown }).body;
  expect(typeof body).toBe('string');
  return JSON.parse(body as string) as Record<string, unknown>;
}

describe('TelemetryService', () => {
  it('does not create an installation id or send events when disabled', async () => {
    const config = makeConfig({ disabled: true });
    const fetchMock = makeFetchMock();

    await new TelemetryService(config, fetchMock).sendEvent('heartbeat');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(fs.existsSync(config.installationIdPath)).toBe(false);
  });

  it('persists one anonymous installation id and reuses it across events', async () => {
    const config = makeConfig();
    const fetchMock = makeFetchMock();
    const service = new TelemetryService(config, fetchMock);

    await service.sendEvent('instance_started');
    const installationId = fs.readFileSync(config.installationIdPath, 'utf8').trim();
    const firstBody = getPostedBody(fetchMock);

    await service.sendEvent('heartbeat');
    const secondBody = getPostedBody(fetchMock, 1);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(firstBody.event).toBe('oss_instance_started');
    expect(secondBody.event).toBe('oss_heartbeat');
    expect(secondBody.distinct_id).toBe(installationId);
    expect(installationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it('reuses an installation id published by another process during the atomic create', async () => {
    const config = makeConfig();
    const fetchMock = makeFetchMock();
    const racedInstallationId = '11111111-1111-4111-8111-111111111111';
    const linkSync = fs.linkSync.bind(fs);
    const linkSpy = vi.spyOn(fs, 'linkSync').mockImplementation((existingPath, newPath) => {
      if (newPath === config.installationIdPath) {
        fs.writeFileSync(config.installationIdPath, racedInstallationId, { mode: 0o600 });
        throw Object.assign(new Error('file exists'), { code: 'EEXIST' });
      }

      return linkSync(existingPath, newPath);
    });

    await new TelemetryService(config, fetchMock).sendEvent('instance_started');

    const body = getPostedBody(fetchMock);
    expect(linkSpy).toHaveBeenCalled();
    expect(body.distinct_id).toBe(racedInstallationId);
    expect(fs.readFileSync(config.installationIdPath, 'utf8')).toBe(racedInstallationId);
    expect(fs.readdirSync(path.dirname(config.installationIdPath))).toEqual([
      path.basename(config.installationIdPath),
    ]);
  });

  it('marks CI telemetry with the CI runtime environment', async () => {
    process.env.CI = 'true';
    const config = makeConfig();
    const fetchMock = makeFetchMock();

    await new TelemetryService(config, fetchMock).sendEvent('instance_started');

    const body = getPostedBody(fetchMock);
    expect(body.properties).toEqual(
      expect.objectContaining({
        runtime_environment: 'ci',
        is_ci: true,
      })
    );
  });

  it('marks local development telemetry with the development runtime environment', async () => {
    clearRuntimeEnvironment();
    process.env.npm_lifecycle_event = 'dev';
    const config = makeConfig();
    const fetchMock = makeFetchMock();

    await new TelemetryService(config, fetchMock).sendEvent('instance_started');

    const body = getPostedBody(fetchMock);
    expect(body.properties).toEqual(
      expect.objectContaining({
        runtime_environment: 'development',
        is_ci: false,
      })
    );
  });

  it.each([
    {
      name: 'CI takes precedence over NODE_ENV',
      setup: () => {
        clearRuntimeEnvironment();
        process.env.CI = 'true';
        process.env.NODE_ENV = 'test';
      },
      expectedRuntimeEnvironment: 'ci',
      expectedIsCi: true,
    },
    {
      name: 'production NODE_ENV',
      setup: () => {
        clearRuntimeEnvironment();
        process.env.NODE_ENV = 'production';
      },
      expectedRuntimeEnvironment: 'production',
      expectedIsCi: false,
    },
    {
      name: 'test NODE_ENV',
      setup: () => {
        clearRuntimeEnvironment();
        process.env.NODE_ENV = 'test';
      },
      expectedRuntimeEnvironment: 'test',
      expectedIsCi: false,
    },
    {
      name: 'unknown runtime',
      setup: clearRuntimeEnvironment,
      expectedRuntimeEnvironment: 'unknown',
      expectedIsCi: false,
    },
  ])(
    'marks telemetry with the $name runtime environment',
    async ({ setup, expectedRuntimeEnvironment, expectedIsCi }) => {
      setup();
      const config = makeConfig();
      const fetchMock = makeFetchMock();

      await new TelemetryService(config, fetchMock).sendEvent('instance_started');

      const body = getPostedBody(fetchMock);
      expect(body.properties).toEqual(
        expect.objectContaining({
          runtime_environment: expectedRuntimeEnvironment,
          is_ci: expectedIsCi,
        })
      );
    }
  );

  it('starts once, schedules heartbeats, and stops the heartbeat timer', async () => {
    vi.useFakeTimers();
    try {
      const config = makeConfig({ heartbeatIntervalMs: 1_000 });
      const fetchMock = makeFetchMock();
      const service = new TelemetryService(config, fetchMock);

      service.start();
      await Promise.resolve();
      await Promise.resolve();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(getPostedBody(fetchMock).event).toBe('oss_instance_started');

      service.start();
      await Promise.resolve();
      await Promise.resolve();

      expect(fetchMock).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(config.heartbeatIntervalMs);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(getPostedBody(fetchMock, 1).event).toBe('oss_heartbeat');

      service.stop();
      await vi.advanceTimersByTimeAsync(config.heartbeatIntervalMs);

      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends only coarse, non-sensitive runtime fields', async () => {
    const config = makeConfig();
    const fetchMock = makeFetchMock();

    await new TelemetryService(config, fetchMock).sendEvent('heartbeat');

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://telemetry.test/v1/events',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'content-type': 'application/json',
        }),
      })
    );

    const body = getPostedBody(fetchMock);
    expect(body).toEqual({
      api_key: 'phc_test',
      event: 'oss_heartbeat',
      distinct_id: expect.any(String),
      timestamp: expect.any(String),
      properties: {
        $process_person_profile: false,
        installation_id: expect.any(String),
        telemetry_source: 'insforge_oss',
        telemetry_event_name: 'heartbeat',
        version: expect.any(String),
        hosting_mode: expect.stringMatching(/^(cloud|self-hosted)$/),
        deployment_method: expect.any(String),
        platform: process.platform,
        arch: process.arch,
        node_version: process.version,
        runtime_environment: expect.stringMatching(/^(production|development|test|ci|unknown)$/),
        is_ci: expect.any(Boolean),
        storage_backend: expect.stringMatching(/^(local|s3|s3-compatible)$/),
        features: {
          site_deployments_configured: expect.any(Boolean),
          functions_configured: expect.any(Boolean),
          compute_configured: expect.any(Boolean),
          openrouter_configured: expect.any(Boolean),
        },
      },
    });
    expect(JSON.stringify(body)).not.toContain('JWT_SECRET');
    expect(JSON.stringify(body)).not.toContain('ACCESS_API_KEY');
    expect(JSON.stringify(body)).not.toContain('POSTGRES_PASSWORD');
  });

  it('logs and suppresses network errors', async () => {
    const config = makeConfig();
    const fetchMock = vi.fn(async () => {
      throw new Error('network down');
    }) as FetchFunction;
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger);

    await expect(new TelemetryService(config, fetchMock).sendEvent('heartbeat')).resolves.toBe(
      undefined
    );

    expect(warnSpy).toHaveBeenCalledWith(
      'InsForge telemetry skipped',
      expect.objectContaining({ error: 'network down' })
    );
  });
});
