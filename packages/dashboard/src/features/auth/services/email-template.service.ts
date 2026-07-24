import { apiClient } from '#lib/api/client';
import type {
  ListEmailTemplatesResponse,
  UpdateEmailTemplateRequest,
  EmailTemplateSchema,
} from '@insforge/shared-schemas';

export class EmailTemplateService {
  async getTemplates(providerType: string = 'custom_smtp'): Promise<ListEmailTemplatesResponse> {
    return apiClient.request(`/auth/email-templates?provider=${providerType}`);
  }

  async updateTemplate(
    type: string,
    data: UpdateEmailTemplateRequest,
    providerType: string = 'custom_smtp'
  ): Promise<EmailTemplateSchema> {
    return apiClient.request(`/auth/email-templates/${type}?provider=${providerType}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }
}

export const emailTemplateService = new EmailTemplateService();
