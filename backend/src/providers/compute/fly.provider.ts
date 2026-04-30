import { config } from '@/infra/config/app.config.js';
import logger from '@/utils/logger.js';
import type { ComputeProvider } from './compute.provider.js';

const FLY_API_BASE = 'https://api.machines.dev/v1';

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
    return !!config.fly.apiToken && !!config.fly.org;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${config.fly.apiToken}`,
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
      throw new Error(`Fly API error (${response.status}): ${text}`);
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
          Authorization: `Bearer ${config.fly.apiToken}`,
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
        Authorization: `Bearer ${config.fly.apiToken}`,
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

  async launchMachine(params: {
    appId: string;
    image: string;
    port: number;
    cpu: string;
    memory: number;
    envVars: Record<string, string>;
    region: string;
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
            {
              ports: [
                { port: 443, handlers: ['tls', 'http'] },
                { port: 80, handlers: ['http'] },
              ],
              internal_port: params.port,
              protocol: 'tcp',
            },
          ],
        },
        region: params.region,
      }),
    });
    return { machineId: result.id };
  }

  async updateMachine(params: {
    appId: string;
    machineId: string;
    image: string;
    port: number;
    cpu: string;
    memory: number;
    envVars: Record<string, string>;
  }): Promise<void> {
    const guest = this.mapCpuTier(params.cpu, params.memory);
    await this.request(`/apps/${params.appId}/machines/${params.machineId}`, {
      method: 'POST',
      body: JSON.stringify({
        config: {
          image: params.image,
          guest,
          env: params.envVars,
          services: [
            {
              ports: [
                { port: 443, handlers: ['tls', 'http'] },
                { port: 80, handlers: ['http'] },
              ],
              internal_port: params.port,
              protocol: 'tcp',
            },
          ],
        },
      }),
    });
  }

  async stopMachine(appId: string, machineId: string): Promise<void> {
    await this.request(`/apps/${appId}/machines/${machineId}/stop`, { method: 'POST' });
  }

  async startMachine(appId: string, machineId: string): Promise<void> {
    // Wait for machine to reach a startable state (stopped/created)
    await this.waitForState(appId, machineId, ['stopped', 'created'], 30_000);
    await this.request(`/apps/${appId}/machines/${machineId}/start`, { method: 'POST' });
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
    await this.request(`/apps/${appId}/machines/${machineId}?force=true`, { method: 'DELETE' });
  }

  async listMachines(appId: string): Promise<{ id: string; state: string; region: string }[]> {
    const machines = await this.request<{ id: string; state: string; region: string }[]>(
      `/apps/${appId}/machines`
    );
    return machines ?? [];
  }

  async getMachineStatus(appId: string, machineId: string): Promise<{ state: string }> {
    const result = await this.requestJson<{ state: string }>(
      `/apps/${appId}/machines/${machineId}`
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
    const events = await this.request<
      { type: string; status: string; source: string; timestamp: number }[]
    >(`/apps/${appId}/machines/${machineId}/events`);

    const mapped = (events ?? []).map((e) => ({
      timestamp: e.timestamp,
      message: `[${e.source}] ${e.type}: ${e.status}`,
    }));

    const limit = options?.limit ?? 100;
    return mapped.slice(0, limit);
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
