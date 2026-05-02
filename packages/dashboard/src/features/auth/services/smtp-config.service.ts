import { apiClient } from '#lib/api/client';
import type { SmtpConfigSchema, UpsertSmtpConfigRequest } from '@insforge/shared-schemas';

export class SmtpConfigService {
  async getConfig(): Promise<SmtpConfigSchema> {
    return apiClient.request('/auth/smtp-config');
  }

  async updateConfig(config: UpsertSmtpConfigRequest): Promise<SmtpConfigSchema> {
    return apiClient.request('/auth/smtp-config', {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  }
}

export const smtpConfigService = new SmtpConfigService();
