import { apiClient } from '#lib/api/client';
import type {
  CustomOAuthConfigSchema,
  CreateCustomOAuthConfigRequest,
  UpdateCustomOAuthConfigRequest,
  ListCustomOAuthConfigsResponse,
} from '@insforge/shared-schemas';

export class CustomOAuthConfigService {
  async getAllConfigs(): Promise<ListCustomOAuthConfigsResponse> {
    return apiClient.request('/auth/oauth/custom/configs');
  }

  async getConfigByKey(key: string): Promise<CustomOAuthConfigSchema & { clientSecret?: string }> {
    return apiClient.request(`/auth/oauth/custom/${key}/config`);
  }

  async createConfig(config: CreateCustomOAuthConfigRequest): Promise<CustomOAuthConfigSchema> {
    return apiClient.request('/auth/oauth/custom/configs', {
      method: 'POST',
      body: JSON.stringify(config),
    });
  }

  async updateConfig(
    key: string,
    config: UpdateCustomOAuthConfigRequest
  ): Promise<CustomOAuthConfigSchema> {
    return apiClient.request(`/auth/oauth/custom/${key}/config`, {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  }

  async deleteConfig(key: string): Promise<{ success: boolean; message: string }> {
    return apiClient.request(`/auth/oauth/custom/${key}/config`, {
      method: 'DELETE',
    });
  }
}

export const customOAuthConfigService = new CustomOAuthConfigService();
