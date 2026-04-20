import jwt from 'jsonwebtoken';
import { config } from '@/infra/config/app.config.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import type {
  ComputeProvider,
  LaunchMachineParams,
  UpdateMachineParams,
  MachineSummary,
  ComputeEvent,
} from './compute.provider.js';

export class CloudComputeProvider implements ComputeProvider {
  private static instance: CloudComputeProvider;

  static getInstance(): CloudComputeProvider {
    if (!CloudComputeProvider.instance) {
      CloudComputeProvider.instance = new CloudComputeProvider();
    }
    return CloudComputeProvider.instance;
  }

  isConfigured(): boolean {
    return (
      config.cloud.computeEnabled === true &&
      !!config.cloud?.projectId &&
      config.cloud.projectId !== 'local' &&
      !!config.app?.jwtSecret
    );
  }

  private signToken(): string {
    if (!this.isConfigured()) {
      throw new AppError(
        'Cloud compute not configured (need PROJECT_ID, JWT_SECRET, CLOUD_COMPUTE_ENABLED)',
        500,
        ERROR_CODES.COMPUTE_NOT_CONFIGURED,
      );
    }
    return jwt.sign({ sub: config.cloud.projectId }, config.app.jwtSecret, {
      expiresIn: '10m',
    });
  }

  private url(path: string): string {
    return `${config.cloud.apiHost}/projects/v1/${config.cloud.projectId}/compute${path}`;
  }

  private async call<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T | undefined> {
    // signToken throws AppError(COMPUTE_NOT_CONFIGURED) if config missing —
    // we want that to surface to the caller, not get masked as CLOUD_UNAVAILABLE.
    const sign = this.signToken();

    let response: Response;
    try {
      response = await fetch(this.url(path), {
        method,
        headers: {
          sign,
          'Content-Type': 'application/json',
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      // Only network/fetch errors arrive here — re-wrap as COMPUTE_CLOUD_UNAVAILABLE
      throw new AppError(
        `COMPUTE_CLOUD_UNAVAILABLE: ${(err as Error).message}`,
        503,
        ERROR_CODES.COMPUTE_CLOUD_UNAVAILABLE,
        'Check CLOUD_API_HOST is reachable and verify cloud backend health.',
      );
    }
    const text = await response.text();
    if (!response.ok) {
      throw new AppError(
        text || `Cloud compute error (${response.status})`,
        response.status,
        ERROR_CODES.COMPUTE_PROVIDER_ERROR,
      );
    }
    return text ? (JSON.parse(text) as T) : undefined;
  }

  async createApp(params: { name: string; network: string; org: string }) {
    const result = await this.call<{ appId: string; serviceId?: string }>(
      'POST',
      '/apps',
      { name: params.name, network: params.network },
    );
    return { appId: result?.appId ?? params.name };
  }

  async destroyApp(appId: string): Promise<void> {
    await this.call('DELETE', `/apps/${encodeURIComponent(appId)}`);
  }

  async launchMachine(params: LaunchMachineParams): Promise<{ machineId: string }> {
    const result = await this.call<{ machineId: string }>('POST', '/machines', params);
    return { machineId: result!.machineId };
  }

  async updateMachine(params: UpdateMachineParams): Promise<void> {
    await this.call('PATCH', `/machines/${encodeURIComponent(params.machineId)}`, params);
  }

  async stopMachine(appId: string, machineId: string): Promise<void> {
    await this.call('POST', `/machines/${encodeURIComponent(machineId)}/stop`, { appId });
  }

  async startMachine(appId: string, machineId: string): Promise<void> {
    await this.call('POST', `/machines/${encodeURIComponent(machineId)}/start`, { appId });
  }

  async destroyMachine(appId: string, machineId: string): Promise<void> {
    await this.call('DELETE', `/machines/${encodeURIComponent(machineId)}`, { appId });
  }

  async listMachines(appId: string): Promise<MachineSummary[]> {
    return (
      (await this.call<MachineSummary[]>(
        'GET',
        `/machines?appId=${encodeURIComponent(appId)}`,
      )) ?? []
    );
  }

  async getMachineStatus(appId: string, machineId: string): Promise<{ state: string }> {
    return (await this.call<{ state: string }>(
      'GET',
      `/machines/${encodeURIComponent(machineId)}?appId=${encodeURIComponent(appId)}`,
    ))!;
  }

  async getLogs(
    appId: string,
    machineId: string,
    options?: { limit?: number },
  ): Promise<ComputeEvent[]> {
    const qs =
      `?appId=${encodeURIComponent(appId)}` +
      (options?.limit ? `&limit=${options.limit}` : '');
    return (
      (await this.call<ComputeEvent[]>(
        'GET',
        `/machines/${encodeURIComponent(machineId)}/events${qs}`,
      )) ?? []
    );
  }

  async waitForState(
    appId: string,
    machineId: string,
    targetStates: string[],
    timeoutMs = 60_000,
  ): Promise<string> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const { state } = await this.getMachineStatus(appId, machineId);
      if (targetStates.includes(state)) return state;
      await new Promise((r) => setTimeout(r, 1500));
    }
    throw new AppError(
      `Machine ${machineId} did not reach ${targetStates.join('|')} within ${timeoutMs}ms`,
      504,
      ERROR_CODES.COMPUTE_PROVIDER_ERROR,
    );
  }
}
