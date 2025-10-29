import { apiClient } from '@/lib/api/client';
import {
  OAuthConfigSchema,
  CreateOAuthConfigRequest,
  UpdateOAuthConfigRequest,
  ListOAuthConfigsResponse,
  ListPublicOAuthProvidersResponse,
} from '@insforge/shared-schemas';

export class OAuthConfigService {
  // Get public OAuth providers (safe for public API)
  async getPublicProviders(): Promise<ListPublicOAuthProvidersResponse> {
    return apiClient.request('/auth/oauth/providers', {
      skipAuth: true,
    });
  }

  // List all OAuth configurations
  async getAllConfigs(): Promise<ListOAuthConfigsResponse> {
    return apiClient.request('/auth/oauth/configs');
  }

  // Get specific OAuth configuration by provider
  async getConfigByProvider(
    provider: string
  ): Promise<OAuthConfigSchema & { clientSecret?: string }> {
    return apiClient.request(`/auth/oauth/${provider}/config`);
  }

  // Create new OAuth configuration
  async createConfig(config: CreateOAuthConfigRequest): Promise<OAuthConfigSchema> {
    return apiClient.request('/auth/oauth/configs', {
      method: 'POST',
      body: JSON.stringify(config),
    });
  }

  // Update OAuth configuration
  async updateConfig(
    provider: string,
    config: UpdateOAuthConfigRequest
  ): Promise<OAuthConfigSchema> {
    return apiClient.request(`/auth/oauth/${provider}/config`, {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  }

  // Delete OAuth configuration
  async deleteConfig(provider: string): Promise<{ success: boolean; message: string }> {
    return apiClient.request(`/auth/oauth/${provider}/config`, {
      method: 'DELETE',
    });
  }
}

export const oauthConfigService = new OAuthConfigService();
