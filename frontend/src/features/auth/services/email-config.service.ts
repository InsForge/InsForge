import { apiClient } from '@/lib/api/client';
import {
  EmailAuthConfigSchema,
  UpdateEmailAuthConfigRequest,
  GetPublicAuthConfigResponse,
} from '@insforge/shared-schemas';

export class EmailConfigService {
  // Get all public authentication configuration (OAuth + Email)
  async getPublicAuthConfig(): Promise<GetPublicAuthConfigResponse> {
    return apiClient.request('/auth/public-config', {
      skipAuth: true,
    });
  }

  // Get email authentication configuration (admin only)
  async getConfig(): Promise<EmailAuthConfigSchema> {
    return apiClient.request('/auth/email/config');
  }

  // Update email authentication configuration
  async updateConfig(config: UpdateEmailAuthConfigRequest): Promise<EmailAuthConfigSchema> {
    return apiClient.request('/auth/email/config', {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  }
}

export const emailConfigService = new EmailConfigService();
