import { apiClient } from '@/lib/api/client';
import { AuthConfigSchema, UpdateAuthConfigRequest } from '@insforge/shared-schemas';

export class AuthConfigService {
  // Get authentication configuration (admin only)
  async getConfig(): Promise<AuthConfigSchema> {
    return apiClient.request('/auth/config');
  }

  // Update authentication configuration
  async updateConfig(config: UpdateAuthConfigRequest): Promise<AuthConfigSchema> {
    return apiClient.request('/auth/config', {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  }
}

export const authConfigService = new AuthConfigService();
