import { apiClient } from '@/lib/api/client';

export interface OAuthProviderConfig {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  enabled: boolean;
}

export interface OAuthConfig {
  google: OAuthProviderConfig;
  github: OAuthProviderConfig;
}

export interface OAuthStatus {
  google: { enabled: boolean };
  github: { enabled: boolean };
}

export class ConfigService {
  async getOAuthConfig(): Promise<OAuthConfig> {
    return apiClient.request('/config/oauth');
  }

  async updateOAuthConfig(config: OAuthConfig): Promise<{ message: string }> {
    // Backend expects the full config object
    return apiClient.request('/config/oauth', {
      method: 'POST',
      body: JSON.stringify(config),
    });
  }

  async getOAuthStatus(): Promise<OAuthStatus> {
    return apiClient.request('/config/oauth/status');
  }

  async reloadOAuthConfig(): Promise<{ message: string; config: { google: { enabled: boolean }; github: { enabled: boolean } } }> {
    return apiClient.request('/config/oauth/reload', {
      method: 'POST',
    });
  }
}

export const configService = new ConfigService();
