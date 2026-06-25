import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import fetch from 'node-fetch';
import { appConfig } from '@/infra/config/app.config.js';
import { isCloudEnvironment } from '@/utils/environment.js';
import logger from '@/utils/logger.js';
import packageJson from '../../../../package.json';

export type TelemetryEventName = 'instance_started' | 'heartbeat';

export interface TelemetryConfig {
  disabled: boolean;
  debug: boolean;
  endpoint: string;
  installationIdPath: string;
  heartbeatIntervalMs: number;
  requestTimeoutMs: number;
}

interface TelemetryEvent {
  eventName: TelemetryEventName;
  installationId: string;
  timestamp: string;
  version: string;
  properties: {
    hostingMode: 'cloud' | 'self-hosted';
    deploymentMethod: string;
    platform: NodeJS.Platform;
    arch: string;
    nodeVersion: string;
    isCi: boolean;
    storageBackend: 'local' | 's3' | 's3-compatible';
    features: {
      siteDeploymentsConfigured: boolean;
      functionsConfigured: boolean;
      computeConfigured: boolean;
      openRouterConfigured: boolean;
    };
  };
}

type FetchFunction = typeof fetch;
type TimerHandle = ReturnType<typeof setInterval>;

const CI_ENV_KEYS = ['CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'BUILDKITE', 'CIRCLECI', 'JENKINS_URL'];

export class TelemetryService {
  private static instance: TelemetryService | undefined;

  private heartbeatTimer: TimerHandle | undefined;

  public constructor(
    private readonly config: TelemetryConfig = appConfig.telemetry,
    private readonly fetchImpl: FetchFunction = fetch
  ) {}

  public static getInstance(): TelemetryService {
    if (!TelemetryService.instance) {
      TelemetryService.instance = new TelemetryService();
    }
    return TelemetryService.instance;
  }

  public start(): void {
    if (this.config.disabled || this.heartbeatTimer) {
      return;
    }

    void this.sendEvent('instance_started');

    this.heartbeatTimer = setInterval(() => {
      void this.sendEvent('heartbeat');
    }, this.config.heartbeatIntervalMs);
    this.heartbeatTimer.unref?.();
  }

  public stop(): void {
    if (!this.heartbeatTimer) {
      return;
    }

    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }

  public async sendEvent(eventName: TelemetryEventName): Promise<void> {
    if (this.config.disabled) {
      return;
    }

    try {
      const event = this.buildEvent(eventName, this.getOrCreateInstallationId());

      if (this.config.debug) {
        logger.info('InsForge telemetry event', { event });
        return;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
      timeout.unref?.();

      try {
        const response = await this.fetchImpl(this.config.endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'user-agent': `insforge/${packageJson.version}`,
          },
          body: JSON.stringify(event),
          signal: controller.signal,
        });

        if (!response.ok) {
          logger.warn('InsForge telemetry request failed', {
            status: response.status,
            statusText: response.statusText,
          });
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      logger.warn('InsForge telemetry skipped', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private getOrCreateInstallationId(): string {
    const existingId = this.readInstallationId();
    if (existingId) {
      return existingId;
    }

    const installationId = randomUUID();
    fs.mkdirSync(path.dirname(this.config.installationIdPath), { recursive: true });
    fs.writeFileSync(this.config.installationIdPath, installationId, { mode: 0o600 });
    return installationId;
  }

  private readInstallationId(): string | null {
    try {
      const id = fs.readFileSync(this.config.installationIdPath, 'utf8').trim();
      return id.length > 0 ? id : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  private buildEvent(eventName: TelemetryEventName, installationId: string): TelemetryEvent {
    return {
      eventName,
      installationId,
      timestamp: new Date().toISOString(),
      version: packageJson.version,
      properties: {
        hostingMode: isCloudEnvironment() ? 'cloud' : 'self-hosted',
        deploymentMethod: detectDeploymentMethod(),
        platform: os.platform(),
        arch: os.arch(),
        nodeVersion: process.version,
        isCi: CI_ENV_KEYS.some((key) => !!process.env[key]),
        storageBackend: detectStorageBackend(),
        features: {
          siteDeploymentsConfigured: Boolean(
            appConfig.deployments.vercelToken &&
            appConfig.deployments.vercelTeamId &&
            appConfig.deployments.vercelProjectId
          ),
          functionsConfigured: Boolean(
            appConfig.denoSubhosting.token && appConfig.denoSubhosting.organizationId
          ),
          computeConfigured: Boolean(appConfig.fly.apiToken && appConfig.fly.org),
          openRouterConfigured: Boolean(appConfig.ai.openrouterApiKey),
        },
      },
    };
  }
}

function detectStorageBackend(): 'local' | 's3' | 's3-compatible' {
  if (appConfig.storage.s3EndpointUrl) {
    return 's3-compatible';
  }

  if (appConfig.storage.s3Bucket) {
    return 's3';
  }

  return 'local';
}

function detectDeploymentMethod(): string {
  if (process.env.RAILWAY_ENVIRONMENT_ID) {
    return 'railway';
  }

  if (process.env.ZEABUR) {
    return 'zeabur';
  }

  if (process.env.SEALOS_APP_NAME) {
    return 'sealos';
  }

  if (process.env.DOKPLOY_PROJECT_NAME) {
    return 'dokploy';
  }

  if (process.env.KUBERNETES_SERVICE_HOST) {
    return 'kubernetes';
  }

  if (process.env.POSTGRES_HOST === 'postgres') {
    return 'docker-compose';
  }

  return 'unknown';
}
