import { apiClient } from '#lib/api/client';
import type { SmsConfigSchema, UpsertSmsConfigRequest } from '@insforge/shared-schemas';

export class SmsConfigService {
  async getConfig(): Promise<SmsConfigSchema> {
    return apiClient.request('/auth/sms-config');
  }

  async updateConfig(config: UpsertSmsConfigRequest): Promise<SmsConfigSchema> {
    return apiClient.request('/auth/sms-config', {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  }
}

export const smsConfigService = new SmsConfigService();
