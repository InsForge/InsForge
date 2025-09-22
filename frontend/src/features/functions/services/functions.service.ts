import { apiClient } from '@/lib/api/client';

export interface EdgeFunction {
  id: string;
  slug: string;
  name: string;
  description?: string;
  code?: string;
  status: 'draft' | 'active' | 'error';
  created_at: string;
  updated_at: string;
  deployed_at?: string;
}

export class FunctionsService {
  async listFunctions(): Promise<EdgeFunction[]> {
    const data = await apiClient.request('/functions', {
      headers: apiClient.withAccessToken(),
    });
    return Array.isArray(data) ? data : [];
  }

  async getFunctionBySlug(slug: string): Promise<EdgeFunction> {
    return apiClient.request(`/functions/${slug}`, {
      headers: apiClient.withAccessToken(),
    });
  }

  async deleteFunction(slug: string): Promise<void> {
    return apiClient.request(`/functions/${slug}`, {
      method: 'DELETE',
      headers: apiClient.withAccessToken(),
    });
  }
}

export const functionsService = new FunctionsService();
