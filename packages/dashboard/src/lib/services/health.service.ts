import { apiClient } from '#lib/api/client';

export interface HealthResponse {
  version: string;
  status?: string;
}

export class HealthService {
  async getHealth(): Promise<HealthResponse> {
    return apiClient.request('/health');
  }
}

export const healthService = new HealthService();
