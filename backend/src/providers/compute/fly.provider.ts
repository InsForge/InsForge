import { config } from '@/infra/config/app.config.js';
import logger from '@/utils/logger.js';

const FLY_API_BASE = 'https://api.machines.dev/v1';

export class FlyProvider {
  private static instance: FlyProvider;

  static getInstance(): FlyProvider {
    if (!FlyProvider.instance) {
      FlyProvider.instance = new FlyProvider();
    }
    return FlyProvider.instance;
  }

  isConfigured(): boolean {
    return config.fly.enabled && !!config.fly.apiToken;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${config.fly.apiToken}`,
      'Content-Type': 'application/json',
    };
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
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

    return response.json() as Promise<T>;
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
    return { appId: params.name };
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
    const result = await this.request<{ id: string }>(`/apps/${params.appId}/machines`, {
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
      method: 'PATCH',
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
    await this.request(`/apps/${appId}/machines/${machineId}/start`, { method: 'POST' });
  }

  async destroyMachine(appId: string, machineId: string): Promise<void> {
    await this.request(`/apps/${appId}/machines/${machineId}`, { method: 'DELETE' });
  }

  async getMachineStatus(appId: string, machineId: string): Promise<{ state: string }> {
    const result = await this.request<{ state: string }>(
      `/apps/${appId}/machines/${machineId}`,
    );
    return { state: result.state };
  }

  async getLogs(
    appId: string,
    options?: { limit?: number },
  ): Promise<{ timestamp: number; message: string }[]> {
    const params = new URLSearchParams();
    if (options?.limit) params.set('limit', String(options.limit));
    const result = await this.request<{
      data: { timestamp: string; message: string }[];
    }>(`/apps/${appId}/logs?${params.toString()}`);
    return (result.data ?? []).map((e) => ({
      timestamp: new Date(e.timestamp).getTime(),
      message: e.message,
    }));
  }

  private mapCpuTier(
    cpu: string,
    memory: number,
  ): { cpu_kind: string; cpus: number; memory_mb: number } {
    const tiers: Record<string, { cpu_kind: string; cpus: number }> = {
      'shared-1x': { cpu_kind: 'shared', cpus: 1 },
      'shared-2x': { cpu_kind: 'shared', cpus: 2 },
      'performance-1x': { cpu_kind: 'performance', cpus: 1 },
      'performance-2x': { cpu_kind: 'performance', cpus: 2 },
      'performance-4x': { cpu_kind: 'performance', cpus: 4 },
    };
    const tier = tiers[cpu] ?? tiers['shared-1x'];
    return { ...tier, memory_mb: memory };
  }
}
