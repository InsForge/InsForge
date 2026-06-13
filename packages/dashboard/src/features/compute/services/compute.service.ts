import { apiClient } from '#lib/api/client';
import type {
  ServiceSchema,
  CreateServiceRequest,
  UpdateServiceRequest,
} from '@insforge/shared-schemas';

interface ListServicesResponse {
  services: ServiceSchema[];
}

type EventEntry = { timestamp: number; message: string };
type LogLine = { timestamp: number; message: string; instance?: string; region?: string };
type LogsResponse = { lines: LogLine[]; nextToken: string | null };

class ComputeServicesApiService {
  async list(): Promise<ServiceSchema[]> {
    const response = await apiClient.request('/compute/services', {
      headers: apiClient.withAccessToken(),
    });
    // successResponse sends array directly; handle both shapes for safety
    return Array.isArray(response)
      ? response
      : ((response as ListServicesResponse)?.services ?? []);
  }

  async get(id: string): Promise<ServiceSchema> {
    return apiClient.request(`/compute/services/${id}`, {
      headers: apiClient.withAccessToken(),
    });
  }

  async create(data: CreateServiceRequest): Promise<ServiceSchema> {
    return apiClient.request('/compute/services', {
      method: 'POST',
      headers: apiClient.withAccessToken(),
      body: JSON.stringify(data),
    });
  }

  async update(id: string, data: UpdateServiceRequest): Promise<ServiceSchema> {
    return apiClient.request(`/compute/services/${id}`, {
      method: 'PATCH',
      headers: apiClient.withAccessToken(),
      body: JSON.stringify(data),
    });
  }

  // Backend returns { message: 'Service deleted' } but callers don't use the return value.
  async remove(id: string): Promise<void> {
    await apiClient.request(`/compute/services/${id}`, {
      method: 'DELETE',
      headers: apiClient.withAccessToken(),
    });
  }

  async stop(id: string): Promise<ServiceSchema> {
    return apiClient.request(`/compute/services/${id}/stop`, {
      method: 'POST',
      headers: apiClient.withAccessToken(),
    });
  }

  async start(id: string): Promise<ServiceSchema> {
    return apiClient.request(`/compute/services/${id}/start`, {
      method: 'POST',
      headers: apiClient.withAccessToken(),
    });
  }

  async events(id: string, limit?: number): Promise<EventEntry[]> {
    const params = limit ? `?limit=${limit}` : '';
    const response = await apiClient.request(`/compute/services/${id}/events${params}`, {
      headers: apiClient.withAccessToken(),
    });
    // successResponse sends array directly; handle both shapes
    return Array.isArray(response)
      ? response
      : ((response as { events: EventEntry[] })?.events ?? []);
  }

  /**
   * Fetch container logs for a service. Pass `nextToken` (returned in the
   * response) to page forward when live-tailing; `limit` caps the window.
   */
  async logs(id: string, opts?: { limit?: number; nextToken?: string }): Promise<LogsResponse> {
    const params = new URLSearchParams();
    if (opts?.limit) {
      params.set('limit', String(opts.limit));
    }
    if (opts?.nextToken) {
      params.set('next_token', opts.nextToken);
    }
    const qs = params.toString() ? `?${params.toString()}` : '';
    const response = await apiClient.request(`/compute/services/${id}/logs${qs}`, {
      headers: apiClient.withAccessToken(),
    });
    const r = response as Partial<LogsResponse> | null;
    return { lines: r?.lines ?? [], nextToken: r?.nextToken ?? null };
  }
}

export const computeServicesApi = new ComputeServicesApiService();
