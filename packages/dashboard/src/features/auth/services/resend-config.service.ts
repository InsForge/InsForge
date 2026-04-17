import { apiClient } from '../../../lib/api/client';
import type { ResendConfigSchema, UpsertResendConfigRequest } from '@insforge/shared-schemas';

export class ResendConfigService {
  async getConfig(): Promise<ResendConfigSchema> {
    return apiClient.request('/auth/resend-config');
  }

  async updateConfig(config: UpsertResendConfigRequest): Promise<ResendConfigSchema> {
    return apiClient.request('/auth/resend-config', {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  }
}

export const resendConfigService = new ResendConfigService();
