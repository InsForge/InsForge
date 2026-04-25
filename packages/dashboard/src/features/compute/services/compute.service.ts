import { apiClient } from '../../../lib/api/client';
import type {
  ServiceSchema,
  CreateServiceRequest,
  UpdateServiceRequest,
} from '@insforge/shared-schemas';

interface ListServicesResponse {
  services: ServiceSchema[];
}

type LogEntry = { timestamp: number; message: string };

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

  async logs(id: string, limit?: number): Promise<LogEntry[]> {
    const params = limit ? `?limit=${limit}` : '';
    const response = await apiClient.request(`/compute/services/${id}/logs${params}`, {
      headers: apiClient.withAccessToken(),
    });
    // successResponse sends array directly; handle both shapes
    return Array.isArray(response) ? response : ((response as { logs: LogEntry[] })?.logs ?? []);
  }
}

export const computeServicesApi = new ComputeServicesApiService();
