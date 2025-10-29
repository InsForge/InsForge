import { apiClient } from '@/lib/api/client';
import {
  EmailAuthConfigSchema,
  UpdateEmailAuthConfigRequest,
  PublicEmailAuthConfig,
} from '@insforge/shared-schemas';

export class EmailConfigService {
  // Get public email authentication configuration (safe for public API)
  async getPublicConfig(): Promise<PublicEmailAuthConfig> {
    return apiClient.request('/auth/email/public-config', {
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
