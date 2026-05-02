import { apiClient } from '#lib/api/client';
import type {
  ListEmailTemplatesResponse,
  UpdateEmailTemplateRequest,
  EmailTemplateSchema,
} from '@insforge/shared-schemas';

export class EmailTemplateService {
  async getTemplates(): Promise<ListEmailTemplatesResponse> {
    return apiClient.request('/auth/email-templates');
  }

  async updateTemplate(
    type: string,
    data: UpdateEmailTemplateRequest
  ): Promise<EmailTemplateSchema> {
    return apiClient.request(`/auth/email-templates/${type}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }
}

export const emailTemplateService = new EmailTemplateService();
