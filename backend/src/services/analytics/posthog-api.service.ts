import axios, { AxiosRequestConfig } from 'axios';

// PostHog Cloud hosts. v1 of the self-hosted integration talks to PostHog Cloud
// only, so this doubles as the SSRF allowlist: `host` comes from the stored
// connection and is used to build outbound URLs, and assertHost() is checked
// before every call. Supporting a developer's own PostHog instance means
// letting an arbitrary URL through here, which needs its own scheme/target
// validation — deliberately out of scope for v1.
export const POSTHOG_HOST_BY_REGION = {
  US: 'https://us.posthog.com',
  EU: 'https://eu.posthog.com',
} as const;

export type PosthogHostRegion = keyof typeof POSTHOG_HOST_BY_REGION;

const VALID_HOSTNAMES = new Set(
  Object.values(POSTHOG_HOST_BY_REGION).map((u) => new URL(u).hostname)
);

// RFC 9110 allows Retry-After as delta-seconds or an HTTP-date; parseInt turns
// the date form into NaN, abandoning a retry PostHog invited. Null when unusable.
function parseRetryAfterSeconds(raw: unknown): number | null {
  if (typeof raw !== 'string' || !raw.trim()) {
    return null;
  }
  const seconds = Number(raw.trim());
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds);
  }
  const at = Date.parse(raw);
  return Number.isNaN(at) ? null : Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

// Scheme too, not just hostname: a hand-edited `http://us.posthog.com` would
// otherwise pass and put the personal API key on the wire in plaintext.
export function isValidPosthogHost(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    return url.protocol === 'https:' && VALID_HOSTNAMES.has(url.hostname);
  } catch {
    return false;
  }
}

const REQUEST_TIMEOUT_MS = 15000;
const MAX_RETRY_AFTER_SECONDS = 30;
// Bounds a cyclic or unbounded `next` cursor during discovery.
const MAX_DISCOVERY_PAGES = 20;
// Pinned to match cloud-backend's POSTHOG_API_VERSION default so both paths
// speak the same PostHog API contract.
const API_VERSION = '0.1d';

interface AuthedInput {
  personalApiKey: string;
  host: string;
}

interface ProjectScopedInput extends AuthedInput {
  posthogProjectId: string;
}

export interface PosthogOrganization {
  id: string;
  name: string;
}

export interface PosthogProjectSummary {
  id: number | string;
  name: string;
  api_token?: string;
  organization?: string;
}

/**
 * Thin PostHog REST client. Ported from cloud-backend's PosthogApiService so
 * self-hosting talks to PostHog directly instead of proxying through
 * InsForge Cloud. Auth is always `Bearer <personal API key>`.
 */
export class PostHogApiService {
  private static instance: PostHogApiService;

  static getInstance(): PostHogApiService {
    if (!PostHogApiService.instance) {
      PostHogApiService.instance = new PostHogApiService();
    }
    return PostHogApiService.instance;
  }

  // Defence in depth: validated at write time too, but re-checked here so a
  // hand-edited secret row cannot turn the backend into an SSRF gadget.
  private assertHost(host: string): void {
    if (!isValidPosthogHost(host)) {
      throw new Error(`Untrusted PostHog host: ${host}`);
    }
  }

  // --- discovery: turns a bare personal API key into a usable connection ---

  async listOrganizations(input: AuthedInput): Promise<PosthogOrganization[]> {
    this.assertHost(input.host);
    return this.getAllPages<PosthogOrganization>(
      `${input.host}/api/organizations/`,
      input.personalApiKey
    );
  }

  async listProjects(
    input: AuthedInput & { organizationId: string }
  ): Promise<PosthogProjectSummary[]> {
    this.assertHost(input.host);
    return this.getAllPages<PosthogProjectSummary>(
      `${input.host}/api/organizations/${encodeURIComponent(input.organizationId)}/projects/`,
      input.personalApiKey
    );
  }

  // Discovery must be exhaustive — a project on page two would be missing from
  // the picker and rejected as invisible if passed explicitly. `next` is only
  // followed while it stays on the validated host. Hitting the page cap with a
  // valid link left throws rather than returning a silently truncated list the
  // connect flow would treat as complete.
  private async getAllPages<T>(firstUrl: string, personalApiKey: string): Promise<T[]> {
    const items: T[] = [];
    let url: string | null = firstUrl;
    for (let page = 0; url; page++) {
      if (page >= MAX_DISCOVERY_PAGES) {
        throw new Error(
          `PostHog discovery exceeded ${MAX_DISCOVERY_PAGES} pages; refusing to return a partial list`
        );
      }
      const data: { results?: T[]; next?: string | null } = await this.get(url, personalApiKey);
      items.push(...(data.results ?? []));
      url = data.next && isValidPosthogHost(data.next) ? data.next : null;
    }
    return items;
  }

  // --- data reads used by the dashboard ---

  async listDashboards(input: ProjectScopedInput & { limit?: number }): Promise<{
    results: Array<{
      id: number;
      name: string;
      description?: string;
      pinned?: boolean;
      last_modified_at?: string;
    }>;
    count: number;
  }> {
    this.assertHost(input.host);
    return this.get(
      `${input.host}/api/projects/${encodeURIComponent(input.posthogProjectId)}/dashboards/`,
      input.personalApiKey,
      { params: { limit: input.limit ?? 20 } }
    );
  }

  async listEvents(input: ProjectScopedInput & { limit?: number }): Promise<{
    results: Array<{ id: string; event: string; distinct_id: string; timestamp: string }>;
    next?: string | null;
  }> {
    this.assertHost(input.host);
    return this.get(
      `${input.host}/api/projects/${encodeURIComponent(input.posthogProjectId)}/events/`,
      input.personalApiKey,
      { params: { limit: input.limit ?? 10 } }
    );
  }

  async listRecordings(input: ProjectScopedInput & { limit?: number }): Promise<{
    results: Array<Record<string, unknown>>;
  }> {
    this.assertHost(input.host);
    return this.get(
      `${input.host}/api/projects/${encodeURIComponent(input.posthogProjectId)}/session_recordings/`,
      input.personalApiKey,
      { params: { limit: input.limit ?? 10 } }
    );
  }

  async runHogQLQuery(
    input: ProjectScopedInput & { query: string }
  ): Promise<{ results?: unknown[][] }> {
    return this.runQuery({
      ...input,
      queryBody: { query: { kind: 'HogQLQuery', query: input.query } },
    });
  }

  /**
   * POSTs an arbitrary PostHog Query body (WebOverviewQuery, WebStatsTableQuery,
   * TrendsQuery, RetentionQuery, ...) to /api/projects/<id>/query/.
   */
  async runQuery<T = unknown>(input: ProjectScopedInput & { queryBody: unknown }): Promise<T> {
    this.assertHost(input.host);
    // /query/ caches results up to 6h with the default refresh=blocking —
    // force_blocking makes PostHog recompute so the dashboard reflects fresh events.
    const body = {
      ...(input.queryBody as Record<string, unknown>),
      refresh: 'force_blocking',
    };
    return this.post<T>(
      `${input.host}/api/projects/${encodeURIComponent(input.posthogProjectId)}/query/`,
      input.personalApiKey,
      body
    );
  }

  async refreshRecordingShare(
    input: ProjectScopedInput & { recordingId: string }
  ): Promise<{ access_token?: string }> {
    this.assertHost(input.host);
    const baseUrl = `${input.host}/api/projects/${encodeURIComponent(
      input.posthogProjectId
    )}/session_recordings/${encodeURIComponent(input.recordingId)}/sharing`;
    // Two-step: PostHog's POST /sharing/refresh/ rotates the access_token but
    // returns enabled:false, so the resulting /embedded/<token> URL 404s. PATCH
    // enabled:true activates sharing before we hand the URL back.
    await this.post(`${baseUrl}/refresh/`, input.personalApiKey, {});
    const { data } = await axios.patch<{ access_token?: string }>(
      `${baseUrl}/`,
      { enabled: true },
      this.withDefaults(input.personalApiKey)
    );
    return data;
  }

  // --- transport ---

  private async get<T>(
    url: string,
    personalApiKey: string,
    opts: AxiosRequestConfig = {}
  ): Promise<T> {
    return this.withRateLimitRetry(async () => {
      const { data } = await axios.get<T>(url, {
        ...this.withDefaults(personalApiKey),
        ...opts,
        headers: { ...this.withDefaults(personalApiKey).headers, ...opts.headers },
      });
      return data;
    });
  }

  private async post<T>(url: string, personalApiKey: string, body: unknown): Promise<T> {
    return this.withRateLimitRetry(async () => {
      const { data } = await axios.post<T>(url, body, this.withDefaults(personalApiKey));
      return data;
    });
  }

  // Retries once on 429, honouring Retry-After when it is short enough to be
  // worth waiting on. Anything longer is surfaced to the caller instead of
  // holding an inbound request open.
  private async withRateLimitRetry<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.status === 429) {
        // Absent or unparseable header still gets the one retry, after 1s —
        // the behaviour this was ported with. Only an explicit long delay
        // (> 30s) is surfaced instead of holding an inbound request open.
        const retryAfter = parseRetryAfterSeconds(err.response.headers['retry-after']) ?? 1;
        if (retryAfter > MAX_RETRY_AFTER_SECONDS) {
          throw err;
        }
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        return call();
      }
      throw err;
    }
  }

  private withDefaults(personalApiKey: string): AxiosRequestConfig {
    return {
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        Authorization: `Bearer ${personalApiKey}`,
        'API-Version': API_VERSION,
      },
    };
  }
}
