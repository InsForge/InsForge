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
  posthogApiKey: string;
  installationIdPath: string;
  heartbeatIntervalMs: number;
  requestTimeoutMs: number;
}

interface PostHogTelemetryEvent {
  api_key: string;
  event: string;
  distinct_id: string;
  timestamp: string;
  properties: {
    $process_person_profile: false;
    installation_id: string;
    telemetry_source: 'insforge_oss';
    telemetry_event_name: TelemetryEventName;
    version: string;
    hosting_mode: 'cloud' | 'self-hosted';
    deployment_method: string;
    platform: NodeJS.Platform;
    arch: string;
    node_version: string;
    is_ci: boolean;
    storage_backend: 'local' | 's3' | 's3-compatible';
    features: {
      site_deployments_configured: boolean;
      functions_configured: boolean;
      compute_configured: boolean;
      openrouter_configured: boolean;
    };
  };
}

type FetchFunction = typeof fetch;
type TimerHandle = ReturnType<typeof setInterval>;

const CI_ENV_KEYS = ['CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'BUILDKITE', 'CIRCLECI', 'JENKINS_URL'];
const POSTHOG_EVENT_NAMES: Record<TelemetryEventName, string> = {
  instance_started: 'oss_instance_started',
  heartbeat: 'oss_heartbeat',
};

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

  private buildEvent(eventName: TelemetryEventName, installationId: string): PostHogTelemetryEvent {
    return {
      api_key: this.config.posthogApiKey,
      event: POSTHOG_EVENT_NAMES[eventName],
      distinct_id: installationId,
      timestamp: new Date().toISOString(),
      properties: {
        $process_person_profile: false,
        installation_id: installationId,
        telemetry_source: 'insforge_oss',
        telemetry_event_name: eventName,
        version: packageJson.version,
        hosting_mode: isCloudEnvironment() ? 'cloud' : 'self-hosted',
        deployment_method: detectDeploymentMethod(),
        platform: os.platform(),
        arch: os.arch(),
        node_version: process.version,
        is_ci: CI_ENV_KEYS.some((key) => !!process.env[key]),
        storage_backend: detectStorageBackend(),
        features: {
          site_deployments_configured: Boolean(
            appConfig.deployments.vercelToken &&
            appConfig.deployments.vercelTeamId &&
            appConfig.deployments.vercelProjectId
          ),
          functions_configured: Boolean(
            appConfig.denoSubhosting.token && appConfig.denoSubhosting.organizationId
          ),
          compute_configured: Boolean(appConfig.fly.apiToken && appConfig.fly.org),
          openrouter_configured: Boolean(appConfig.ai.openrouterApiKey),
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
