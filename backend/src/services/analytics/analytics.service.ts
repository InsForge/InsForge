import {
  ERROR_CODES,
  type PosthogConfig,
  type PosthogDiscoveredProject,
  type PosthogRegion,
} from '@insforge/shared-schemas';
import { CloudAnalyticsProvider } from '@/providers/analytics/cloud.provider.js';
import { LocalAnalyticsProvider } from '@/providers/analytics/local.provider.js';
import type { AnalyticsProvider } from '@/providers/analytics/base.provider.js';
import { appConfig } from '@/infra/config/app.config.js';
import { AppError } from '@/utils/errors.js';
import { PostHogConfigService } from './posthog-config.service.js';
import { PostHogApiService, POSTHOG_HOST_BY_REGION } from './posthog-api.service.js';

export class AnalyticsService {
  private static instance: AnalyticsService;

  constructor(
    private readonly cloud: AnalyticsProvider = CloudAnalyticsProvider.getInstance(),
    private readonly local: AnalyticsProvider = LocalAnalyticsProvider.getInstance(),
    private readonly config: PostHogConfigService = PostHogConfigService.getInstance(),
    private readonly api: PostHogApiService = PostHogApiService.getInstance()
  ) {}

  static getInstance(): AnalyticsService {
    if (!AnalyticsService.instance) {
      AnalyticsService.instance = new AnalyticsService();
    }
    return AnalyticsService.instance;
  }

  // Mirrors WebscraperService.isSelfHosted(). Cloud projects carry a real
  // PROJECT_ID; self-hosted deployments have none, or the 'local' placeholder.
  static isSelfHosted(): boolean {
    const projectId = appConfig.cloud.projectId;
    return !projectId || projectId === 'local';
  }

  private provider(): AnalyticsProvider {
    return AnalyticsService.isSelfHosted() ? this.local : this.cloud;
  }

  getConnection() {
    return this.provider().getConnection();
  }

  getDashboards() {
    return this.provider().getDashboards();
  }

  getSummary() {
    return this.provider().getSummary();
  }

  getRecentEvents(limit?: number) {
    return this.provider().getRecentEvents(limit);
  }

  disconnect() {
    return this.provider().disconnect();
  }

  getWebOverview(timeframe: string) {
    return this.provider().getWebOverview(timeframe);
  }

  getWebStats(breakdown: string, timeframe: string) {
    return this.provider().getWebStats(breakdown, timeframe);
  }

  getTrends(metric: string, timeframe: string) {
    return this.provider().getTrends(metric, timeframe);
  }

  getRetention() {
    return this.provider().getRetention();
  }

  getRecordings(limit?: number) {
    return this.provider().getRecordings(limit);
  }

  createRecordingShare(recordingId: string) {
    return this.provider().createRecordingShare(recordingId);
  }

  // --- self-hosted connection management ---

  getConfig(): Promise<PosthogConfig> {
    return this.config.getConfig();
  }

  /**
   * Connects a self-hosted deployment to a PostHog Cloud project.
   *
   * The developer supplies only a personal API key (phx_) and a region. The
   * numeric project id and the public ingestion key (phc_) are read back from
   * PostHog rather than typed: `GET /api/organizations/` then
   * `GET /api/organizations/<id>/projects/` returns both, so there is nothing to
   * copy out of a PostHog URL by hand.
   *
   * The key is exercised against PostHog before anything is written, so an
   * invalid paste fails loudly here instead of producing a stored connection
   * that 401s on every dashboard panel.
   */
  async connect(input: {
    personalApiKey: string;
    region: PosthogRegion;
    posthogProjectId?: string;
  }): Promise<PosthogConfig> {
    const personalApiKey = input.personalApiKey.trim();
    const host = POSTHOG_HOST_BY_REGION[input.region];

    const projects = await this.discoverProjects({ personalApiKey, host });
    if (projects.length === 0) {
      throw new AppError(
        'That PostHog key does not have access to any project. Check the key and its scopes, then try again.',
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    let chosen: PosthogDiscoveredProject & { apiKey: string };
    if (input.posthogProjectId) {
      const match = projects.find((p) => p.posthogProjectId === input.posthogProjectId);
      if (!match) {
        throw new AppError(
          `PostHog project ${input.posthogProjectId} is not visible to this key. Available: ${projects
            .map((p) => p.posthogProjectId)
            .join(', ')}`,
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }
      chosen = match;
    } else if (projects.length === 1) {
      chosen = projects[0];
    } else {
      // Ambiguous rather than wrong: picking one arbitrarily would silently wire
      // the dashboard to the wrong product's data.
      throw new AppError(
        `This key can see ${projects.length} PostHog projects. Pass posthogProjectId to choose one: ${projects
          .map((p) => `${p.posthogProjectId} (${p.name})`)
          .join(', ')}`,
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    return this.config.setConnection({
      personalApiKey,
      host,
      posthogProjectId: chosen.posthogProjectId,
      apiKey: chosen.apiKey,
      organizationName: chosen.organizationName,
      projectName: chosen.name,
    });
  }

  /**
   * Lists the PostHog projects a key can reach, so the dashboard can offer a
   * picker instead of asking for a numeric id. Doubles as the credential test:
   * a bad key fails on the first call.
   */
  async listAvailableProjects(input: {
    personalApiKey: string;
    region: PosthogRegion;
  }): Promise<PosthogDiscoveredProject[]> {
    return this.discoverProjects({
      personalApiKey: input.personalApiKey.trim(),
      host: POSTHOG_HOST_BY_REGION[input.region],
    });
  }

  private async discoverProjects(input: {
    personalApiKey: string;
    host: string;
  }): Promise<(PosthogDiscoveredProject & { apiKey: string })[]> {
    let organizations;
    try {
      organizations = await this.api.listOrganizations(input);
    } catch (err) {
      throw this.rejectCredentials(err);
    }

    const discovered: (PosthogDiscoveredProject & { apiKey: string })[] = [];
    for (const org of organizations) {
      let projects;
      try {
        projects = await this.api.listProjects({ ...input, organizationId: org.id });
      } catch (err) {
        throw this.rejectCredentials(err);
      }
      for (const project of projects) {
        discovered.push({
          posthogProjectId: String(project.id),
          name: project.name,
          organizationName: org.name ?? null,
          // api_token is the phc_ ingestion key. A project without one is
          // unusable for SDK setup, but still fine to read data from, so it is
          // stored empty rather than skipped.
          apiKey: project.api_token ?? '',
        });
      }
    }
    return discovered;
  }

  // A rejected key is the user's mistake, not an upstream outage — report it as
  // 400 with remediation rather than 502, so the connect dialog can show it
  // inline on the field.
  private rejectCredentials(err: unknown): AppError {
    const response =
      typeof err === 'object' && err !== null && 'response' in err
        ? (err as { response?: { status?: number; data?: { detail?: unknown } } }).response
        : undefined;
    const status = response?.status;
    if (status === 401 || status === 403) {
      // PostHog's 403 body names the exact missing scope (e.g. "API key missing
      // required scope 'organization:read'") — pass it through instead of
      // making the user guess.
      const detail = typeof response?.data?.detail === 'string' ? response.data.detail : null;
      return new AppError(
        detail
          ? `PostHog rejected that personal API key: ${detail}. It needs read scopes for organizations, projects and queries, and the region must match your PostHog account.`
          : 'PostHog rejected that personal API key. Check the key, that its scopes include organization, project and query read access, and that the selected region matches your PostHog account.',
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }
    const detail = err instanceof Error ? err.message : 'unknown error';
    return new AppError(`Could not reach PostHog: ${detail}`, 502, ERROR_CODES.UPSTREAM_FAILURE);
  }
}
