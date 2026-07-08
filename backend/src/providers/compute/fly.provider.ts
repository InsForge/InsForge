import { appConfig } from '@/infra/config/app.config.js';
import logger from '@/utils/logger.js';
import {
  MachineGoneError,
  translateMachineGone,
  type ComputeProvider,
  type ComputeLogsResult,
} from './compute.provider.js';

const FLY_API_BASE = 'https://api.machines.dev/v1';
// Container stdout/stderr lives on a different host + auth scheme than the
// Machines API: api.fly.io with the `FlyV1 <macaroon>` scheme. The Machines
// host (api.machines.dev) does NOT serve logs, and this endpoint rejects the
// `Bearer` scheme with 401 — verified against a live Fly app. Same token,
// different host + prefix. Fly documents this endpoint as stable-but-unofficial
// (flyctl depends on it); we degrade to a thrown error rather than crash if it
// ever changes shape.
const FLY_LOGS_API_BASE = 'https://api.fly.io/api/v1';

// Fly Machines API field names for the autostop/autostart block on a
// service. Kept narrow on purpose: extend when we expose CLI overrides.
// `autostop` accepts `"off" | "stop" | "suspend"` per fly.MachineService
// in https://docs.machines.dev/spec/openapi3.json.
type ScaleOptions = {
  autostop: 'off' | 'stop' | 'suspend';
  autostart: boolean;
  min_machines_running: number;
};

// Shape of Fly's logs API response (JSON:API-style). Fields are optional on
// purpose — we parse defensively since the endpoint is unofficial.
type FlyLogsResponse = {
  data?: {
    attributes?: {
      timestamp?: string | number;
      message?: string;
      instance?: string;
      region?: string;
    };
  }[];
  meta?: { next_token?: string | number };
};

// Carries the HTTP status of a failed Fly API call so callers can distinguish
// a definitive 404 (machine/app gone) from transient failures. Message format
// is unchanged from the previous plain Error for anything matching on it.
export class FlyHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'FlyHttpError';
  }
}

export class FlyProvider implements ComputeProvider {
  private static instance: FlyProvider;

  static getInstance(): FlyProvider {
    if (!FlyProvider.instance) {
      FlyProvider.instance = new FlyProvider();
    }
    return FlyProvider.instance;
  }

  // Self-hosters enable compute by setting FLY_API_TOKEN AND FLY_ORG. Both
  // are required: org alone has nothing to authenticate, token alone doesn't
  // know which org to create apps in.
  // Cloud-managed mode (CloudComputeProvider) detects itself implicitly from
  // PROJECT_ID + JWT_SECRET + CLOUD_API_HOST and bypasses this check.
  isConfigured(): boolean {
    return !!appConfig.fly.apiToken && !!appConfig.fly.org;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${appConfig.fly.apiToken}`,
      'Content-Type': 'application/json',
    };
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T | undefined> {
    const url = `${FLY_API_BASE}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: { ...this.headers(), ...options.headers },
    });

    if (!response.ok) {
      const text = await response.text();
      logger.error('Fly API error', { url, status: response.status, body: text });
      throw new FlyHttpError(response.status, `Fly API error (${response.status}): ${text}`);
    }

    const text = await response.text();
    if (!text) {
      return undefined;
    }
    return JSON.parse(text) as T;
  }

  private async requestJson<T>(path: string, options: RequestInit = {}): Promise<T> {
    const result = await this.request<T>(path, options);
    if (result === undefined) {
      throw new Error(`Fly API returned empty body for ${options.method ?? 'GET'} ${path}`);
    }
    return result;
  }

  async createApp(params: {
    name: string;
    network: string;
    org: string;
  }): Promise<{ appId: string }> {
    await this.request('/apps', {
      method: 'POST',
      body: JSON.stringify({
        app_name: params.name,
        org_slug: params.org,
        network: params.network,
      }),
    });
    await this.allocatePublicIps(params.name);
    return { appId: params.name };
  }

  private async allocatePublicIps(appId: string): Promise<void> {
    // Race: when called immediately after createApp, Fly's GraphQL returns
    // `{ipAddress: null}` without an `errors` field — no allocation happened,
    // but the response looks successful. Retry with short backoff until we
    // get back an actual ipAddress. Without this the app has IPv6 only, DNS
    // resolves AAAA only, and IPv4-only clients NXDOMAIN on the .fly.dev URL.
    const types: ('shared_v4' | 'v6')[] = ['shared_v4', 'v6'];
    for (const type of types) {
      await this.allocateOneIp(appId, type);
    }
  }

  private async allocateOneIp(appId: string, type: 'shared_v4' | 'v6'): Promise<void> {
    const graphqlEndpoint = 'https://api.fly.io/graphql';
    const mutation = `
      mutation AllocateIp($input: AllocateIPAddressInput!) {
        allocateIpAddress(input: $input) {
          ipAddress { id address type region }
        }
      }
    `;
    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const response = await fetch(graphqlEndpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${appConfig.fly.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: mutation, variables: { input: { appId, type } } }),
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(
          `Fly GraphQL allocateIpAddress(${type}) failed (${response.status}): ${body}`
        );
      }
      const result = (await response.json()) as {
        data?: { allocateIpAddress?: { ipAddress?: { address?: string } | null } | null };
        errors?: unknown;
      };
      if (result.errors) {
        throw new Error(
          `Fly GraphQL allocateIpAddress(${type}) errors: ${JSON.stringify(result.errors)}`
        );
      }
      const ip = result.data?.allocateIpAddress?.ipAddress;
      if (ip && ip.address) {
        return;
      }
      // shared_v4 is an edge case: Fly does not return a per-app address for
      // shared IPs — it flips the app to use the org's shared v4 and returns
      // null. Verify via a follow-up query that `sharedIpAddress` is populated.
      if (type === 'shared_v4' && (await this.hasSharedV4(appId))) {
        return;
      }
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
    throw new Error(
      `Fly GraphQL allocateIpAddress(${type}) returned no address after ${maxAttempts} attempts`
    );
  }

  private async hasSharedV4(appId: string): Promise<boolean> {
    const response = await fetch('https://api.fly.io/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${appConfig.fly.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `query($name: String!) { app(name: $name) { sharedIpAddress } }`,
        variables: { name: appId },
      }),
    });
    if (!response.ok) {
      return false;
    }
    const result = (await response.json()) as {
      data?: { app?: { sharedIpAddress?: string | null } };
    };
    return !!result.data?.app?.sharedIpAddress;
  }

  async destroyApp(appId: string): Promise<void> {
    await this.request(`/apps/${appId}`, { method: 'DELETE' });
  }

  // Scale-to-zero is the default mode — see compute-deploy.md in the skill
  // for the rationale. Callers opt out per-service via the boolean
  // `scaleToZero: false` on launch/update (surfaced as `--always-on` in the
  // CLI); `scaleOptions` maps that onto the Fly autostop block. The defaults
  // stay correct regardless of how callers evolve.
  private static readonly SCALE_TO_ZERO: ScaleOptions = {
    autostop: 'stop',
    autostart: true,
    min_machines_running: 0,
  };

  // `min_machines_running: 1` (not just autostop 'off') so Fly restarts the
  // machine if it exits — always-on services should survive crashes, not
  // just skip the idle stop.
  private static readonly ALWAYS_ON: ScaleOptions = {
    autostop: 'off',
    autostart: true,
    min_machines_running: 1,
  };

  private static scaleOptions(scaleToZero: boolean | undefined): ScaleOptions {
    return scaleToZero === false ? FlyProvider.ALWAYS_ON : FlyProvider.SCALE_TO_ZERO;
  }

  // Single source of truth for the per-machine service block. Both launch
  // and update need to send the same shape, including the autostop fields:
  // without them Fly defaults to never stopping and machines run 24/7 even
  // when idle.
  //
  // Field names are the **Machines API** spelling (`autostart` / `autostop`),
  // NOT fly.toml's longer `auto_start_machines` / `auto_stop_machines`. The
  // Machines API silently ignores unknown fields, so getting these wrong
  // looks like it works but leaves machines always-on. Source of truth:
  // https://docs.machines.dev/spec/openapi3.json — fly.MachineService.
  //
  // `edgeProtocol` selects the edge-handler shape:
  //   - `'http'` (default): TLS-terminated at the Fly anycast edge, HTTP/1.1+H2
  //     proxied to the container's port. Two public ports (443 TLS, 80 plain).
  //   - `'tcp'`: container's port exposed directly with empty handlers, for
  //     Redis / Postgres-protocol / raw TCP services. Single public port =
  //     internal port. Fly's `services[].protocol` stays `'tcp'` either way
  //     (that's the L4 protocol field, not L7).
  private serviceConfig(
    internalPort: number,
    edgeProtocol: 'http' | 'tcp' = 'http',
    scale: ScaleOptions = FlyProvider.SCALE_TO_ZERO
  ) {
    const ports =
      edgeProtocol === 'tcp'
        ? [{ port: internalPort, handlers: [] as string[] }]
        : [
            { port: 443, handlers: ['tls', 'http'] },
            { port: 80, handlers: ['http'] },
          ];
    return {
      ports,
      internal_port: internalPort,
      protocol: 'tcp',
      // Scale config. `stop` (vs `suspend`) fully releases the machine —
      // cheaper for compute that isn't sensitive to ~1s cold-start latency.
      // `min_machines_running: 0` is required for full scale-to-zero (any
      // value > 0 keeps that many warm).
      autostop: scale.autostop,
      autostart: scale.autostart,
      min_machines_running: scale.min_machines_running,
    };
  }

  async launchMachine(params: {
    appId: string;
    image: string;
    port: number;
    cpu: string;
    memory: number;
    envVars: Record<string, string>;
    region: string;
    protocol?: 'http' | 'tcp';
    scaleToZero?: boolean;
  }): Promise<{ machineId: string }> {
    const guest = this.mapCpuTier(params.cpu, params.memory);
    const result = await this.requestJson<{ id: string }>(`/apps/${params.appId}/machines`, {
      method: 'POST',
      body: JSON.stringify({
        config: {
          image: params.image,
          guest,
          env: params.envVars,
          services: [
            this.serviceConfig(
              params.port,
              params.protocol ?? 'http',
              FlyProvider.scaleOptions(params.scaleToZero)
            ),
          ],
        },
        region: params.region,
      }),
    });
    return { machineId: result.id };
  }

  // A definitive 404 from a machine-scoped Fly call means the machine no
  // longer exists (idle reaping, manual delete via the Fly dashboard, host
  // migration). Translate to MachineGoneError so the service layer can heal
  // DB state that still points at the dead machine. Transient errors (5xx,
  // network) pass through untouched.
  private machineScoped<T>(appId: string, machineId: string, fn: () => Promise<T>): Promise<T> {
    return translateMachineGone(
      appId,
      machineId,
      (err) => err instanceof FlyHttpError && err.status === 404,
      fn
    );
  }

  async updateMachine(params: {
    appId: string;
    machineId: string;
    image: string;
    port: number;
    cpu: string;
    memory: number;
    envVars: Record<string, string>;
    protocol?: 'http' | 'tcp';
    scaleToZero?: boolean;
  }): Promise<void> {
    const guest = this.mapCpuTier(params.cpu, params.memory);
    await this.machineScoped(params.appId, params.machineId, () =>
      this.request(`/apps/${params.appId}/machines/${params.machineId}`, {
        method: 'POST',
        body: JSON.stringify({
          config: {
            image: params.image,
            guest,
            env: params.envVars,
            services: [
              this.serviceConfig(
                params.port,
                params.protocol ?? 'http',
                FlyProvider.scaleOptions(params.scaleToZero)
              ),
            ],
          },
        }),
      })
    );
  }

  async stopMachine(appId: string, machineId: string): Promise<void> {
    await this.machineScoped(appId, machineId, () =>
      this.request(`/apps/${appId}/machines/${machineId}/stop`, { method: 'POST' })
    );
  }

  async startMachine(appId: string, machineId: string): Promise<void> {
    await this.machineScoped(appId, machineId, async () => {
      // Wait for machine to reach a startable state (stopped/created)
      await this.waitForState(appId, machineId, ['stopped', 'created'], 30_000);
      await this.request(`/apps/${appId}/machines/${machineId}/start`, { method: 'POST' });
    });
  }

  async waitForState(
    appId: string,
    machineId: string,
    targetStates: string[],
    timeoutMs: number = 30_000
  ): Promise<string> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const { state } = await this.getMachineStatus(appId, machineId);
        if (targetStates.includes(state)) {
          return state;
        }
      } catch (error) {
        // Definitive machine-gone (getMachineStatus translates Fly 404s):
        // polling for 30 more seconds won't bring the machine back. Fail
        // fast so the service layer can heal the stale row.
        if (error instanceof MachineGoneError) {
          throw error;
        }
        logger.warn('Transient error polling machine state, retrying', { appId, machineId, error });
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error(
      `Machine did not reach state [${targetStates.join(',')}] within ${timeoutMs}ms`
    );
  }

  async destroyMachine(appId: string, machineId: string): Promise<void> {
    // force=true so running machines can be destroyed in one call. Without it
    // Fly returns 412 `failed_precondition: unable to destroy machine, not
    // currently stopped, suspended, failed, or pending` and the caller's
    // delete path 502s, leaving the Fly app + DB row orphaned.
    await this.machineScoped(appId, machineId, () =>
      this.request(`/apps/${appId}/machines/${machineId}?force=true`, { method: 'DELETE' })
    );
  }

  async listMachines(appId: string): Promise<{ id: string; state: string; region: string }[]> {
    const machines = await this.request<{ id: string; state: string; region: string }[]>(
      `/apps/${appId}/machines`
    );
    return machines ?? [];
  }

  async getMachineStatus(appId: string, machineId: string): Promise<{ state: string }> {
    const result = await this.machineScoped(appId, machineId, () =>
      this.requestJson<{ state: string }>(`/apps/${appId}/machines/${machineId}`)
    );
    return { state: result.state };
  }

  /**
   * Returns Fly machine lifecycle events (state changes, starts, stops) from
   * /apps/:app/machines/:id/events. This is NOT container stdout/stderr —
   * Fly exposes a separate log streaming service for that.
   */
  async getEvents(
    appId: string,
    machineId: string,
    options?: { limit?: number }
  ): Promise<{ timestamp: number; message: string }[]> {
    const events = await this.machineScoped(appId, machineId, () =>
      this.request<{ type: string; status: string; source: string; timestamp: number }[]>(
        `/apps/${appId}/machines/${machineId}/events`
      )
    );

    const mapped = (events ?? []).map((e) => ({
      timestamp: e.timestamp,
      message: `[${e.source}] ${e.type}: ${e.status}`,
    }));

    const limit = options?.limit ?? 100;
    return mapped.slice(0, limit);
  }

  /**
   * Returns container stdout/stderr ("application logs") from Fly's logs API
   * (api.fly.io/api/v1/apps/:app/logs). Unlike getEvents (machine lifecycle),
   * these are the lines the running process writes. Supports backfill from
   * Fly's ~7-day retention window and forward paging via `nextToken` for
   * live tailing.
   */
  async getLogs(
    appId: string,
    machineId: string,
    options?: { limit?: number; nextToken?: string }
  ): Promise<ComputeLogsResult> {
    const params = new URLSearchParams();
    // Scope to this service's single machine — a Fly app may briefly hold more
    // than one (e.g. mid-redeploy), and we only want this service's lines.
    if (machineId) {
      params.set('instance', machineId);
    }
    if (options?.limit) {
      // Best-effort: forward the page size so Fly returns enough lines rather
      // than relying solely on the local slice below (Fly's default is ~100;
      // unknown params are ignored, so this is safe if unsupported).
      params.set('limit', String(options.limit));
    }
    if (options?.nextToken) {
      params.set('next_token', options.nextToken);
    }
    const url = `${FLY_LOGS_API_BASE}/apps/${appId}/logs?${params.toString()}`;

    let response: Response;
    try {
      // Time-box the upstream call — this endpoint is polled live, so a stalled
      // Fly request must not pile up and degrade API responsiveness.
      response = await fetch(url, {
        headers: {
          Authorization: `FlyV1 ${appConfig.fly.apiToken}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      logger.error('Fly logs API request failed', { url, error });
      throw new Error(`Fly logs API request failed: ${(error as Error).message}`);
    }

    if (!response.ok) {
      const text = await response.text();
      logger.error('Fly logs API error', { url, status: response.status, body: text });
      // NOT translated to MachineGoneError: the logs API is app-scoped, so a
      // 404 here means the whole APP is gone (a reclaimed machine alone still
      // returns 200 with zero lines). Machine-level healing would be wrong —
      // it keeps fly_app_id and advertises a redeploy that launches into the
      // deleted app and fails forever. App-gone recovery is reconcile
      // territory, not this path.
      throw new FlyHttpError(response.status, `Fly logs API error (${response.status}): ${text}`);
    }

    const raw = await response.text();
    const body = JSON.parse(raw) as FlyLogsResponse;

    const lines = (body.data ?? []).map((entry) => {
      const a = entry.attributes ?? {};
      // Fly returns RFC3339 strings (e.g. "2026-06-04T21:25:05.152Z"); some
      // shapes carry epoch numbers. Normalize to epoch ms; 0 if unparseable.
      const parsed = typeof a.timestamp === 'number' ? a.timestamp : Date.parse(a.timestamp ?? '');
      return {
        timestamp: Number.isNaN(parsed) ? 0 : parsed,
        message: a.message ?? '',
        instance: a.instance,
        region: a.region,
      };
    });

    const limit = options?.limit ?? 100;
    // Keep the most-recent `limit` lines (Fly returns oldest→newest).
    const bounded = lines.length > limit ? lines.slice(-limit) : lines;

    // `next_token` is a nanosecond Unix timestamp — it exceeds
    // Number.MAX_SAFE_INTEGER, so JSON.parse() would silently round it and
    // corrupt the cursor. Pull the exact digits from the raw text for numeric
    // tokens. If Fly ever issues a non-numeric (string) cursor, the JSON-parsed
    // value is already safe, so fall back to it rather than dropping the cursor.
    const tokenMatch = raw.match(/"next_token"\s*:\s*"?(\d+)"?/);
    const parsedToken = body.meta?.next_token;
    const nextToken = tokenMatch
      ? tokenMatch[1]
      : typeof parsedToken === 'string'
        ? parsedToken
        : null;

    return { lines: bounded, nextToken };
  }

  // Parse Fly.io's `<kind>-<N>x` format (e.g. shared-2x, performance-8x).
  // We don't maintain a hardcoded allow-list — Fly is the source of truth
  // for which sizes exist. Unsupported combinations (if any) return a clean
  // Fly 4xx at machine-create time instead of being pre-rejected here.
  // Falls back to shared-1x for malformed input so a typo never crashes a
  // deploy; Fly will validate the final spec regardless.
  private mapCpuTier(
    cpu: string,
    memory: number
  ): { cpu_kind: string; cpus: number; memory_mb: number } {
    const m = /^(shared|performance)-([1-9]\d*)x$/.exec(cpu);
    if (!m) {
      return { cpu_kind: 'shared', cpus: 1, memory_mb: memory };
    }
    return { cpu_kind: m[1], cpus: parseInt(m[2], 10), memory_mb: memory };
  }
}
