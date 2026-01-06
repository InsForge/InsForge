import { apiClient } from '@/lib/api/client';
import { FunctionSchema, FunctionListResponse } from '@insforge/shared-schemas';

export class FunctionService {
  async listFunctions(): Promise<FunctionListResponse> {
    const response: FunctionListResponse = await apiClient.request('/functions', {
      headers: apiClient.withAccessToken(),
    });

    return {
      functions: Array.isArray(response.functions) ? response.functions : [],
      runtime: response.runtime || { status: 'unavailable' },
    };
  }

  async getFunctionBySlug(slug: string): Promise<FunctionSchema> {
    const response: FunctionSchema = await apiClient.request(`/functions/${slug}`, {
      headers: apiClient.withAccessToken(),
    });
    return response;
  }

  async deleteFunction(slug: string): Promise<void> {
    return apiClient.request(`/functions/${slug}`, {
      method: 'DELETE',
      headers: apiClient.withAccessToken(),
    });
  }
}

export const functionService = new FunctionService();
