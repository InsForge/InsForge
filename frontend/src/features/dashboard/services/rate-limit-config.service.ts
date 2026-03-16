import { apiClient } from '@/lib/api/client';
import { GetRateLimitConfigResponse, UpdateRateLimitConfigRequest } from '@insforge/shared-schemas';

export class RateLimitConfigService {
  async getConfig(): Promise<GetRateLimitConfigResponse> {
    return apiClient.request('/auth/rate-limits');
  }

  async updateConfig(config: UpdateRateLimitConfigRequest): Promise<GetRateLimitConfigResponse> {
    return apiClient.request('/auth/rate-limits', {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  }
}

export const rateLimitConfigService = new RateLimitConfigService();
