import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Response } from 'node-fetch';
import { TelemetryConfig, TelemetryService } from '../../src/services/telemetry/telemetry.service';
import logger from '../../src/utils/logger';

type FetchFunction = ConstructorParameters<typeof TelemetryService>[1];

const tempRoots: string[] = [];
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
    debug: false,
    endpoint: 'https://telemetry.test/v1/events',
    installationIdPath: path.join(tempRoot, '.insforge-installation-id'),
    heartbeatIntervalMs: 60_000,
    requestTimeoutMs: 500,
    ...overrides,
  };
}

function makeFetchMock(status = 204): FetchFunction {
  return vi.fn(async () => new Response(null, { status })) as FetchFunction;
}

function getPostedBody(fetchMock: FetchFunction): Record<string, unknown> {
  const call = vi.mocked(fetchMock).mock.calls[0];
  const init = call[1];
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

  it('prints the event and skips the network request in debug mode', async () => {
    const config = makeConfig({ debug: true });
    const fetchMock = makeFetchMock();
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => logger);

    await new TelemetryService(config, fetchMock).sendEvent('instance_started');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledWith(
      'InsForge telemetry event',
      expect.objectContaining({
        event: expect.objectContaining({
          eventName: 'instance_started',
          installationId: expect.any(String),
        }),
      })
    );
  });

  it('persists one anonymous installation id and reuses it across events', async () => {
    const config = makeConfig();
    const fetchMock = makeFetchMock();
    const service = new TelemetryService(config, fetchMock);

    await service.sendEvent('instance_started');
    const installationId = fs.readFileSync(config.installationIdPath, 'utf8').trim();

    await service.sendEvent('heartbeat');
    const secondBody = getPostedBody(fetchMock);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(secondBody.installationId).toBe(installationId);
    expect(installationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
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
      eventName: 'heartbeat',
      installationId: expect.any(String),
      timestamp: expect.any(String),
      version: expect.any(String),
      properties: {
        hostingMode: expect.stringMatching(/^(cloud|self-hosted)$/),
        deploymentMethod: expect.any(String),
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        isCi: expect.any(Boolean),
        storageBackend: expect.stringMatching(/^(local|s3|s3-compatible)$/),
        features: {
          siteDeploymentsConfigured: expect.any(Boolean),
          functionsConfigured: expect.any(Boolean),
          computeConfigured: expect.any(Boolean),
          openRouterConfigured: expect.any(Boolean),
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
