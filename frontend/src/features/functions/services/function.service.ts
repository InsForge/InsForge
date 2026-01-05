import { apiClient } from '@/lib/api/client';
import { FunctionSchema } from '@insforge/shared-schemas';

export interface FunctionsResponse {
  functions: FunctionSchema[];
  runtime: {
    status: 'running' | 'unavailable';
  };
}

export class FunctionService {
  async listFunctions(): Promise<FunctionsResponse> {
    const data = await apiClient.request('/functions', {
      headers: apiClient.withAccessToken(),
    });

    return {
      functions: Array.isArray(data.functions) ? data.functions : [],
      runtime: data.runtime || { status: 'unavailable' },
    };
  }

  async getFunctionBySlug(slug: string): Promise<FunctionSchema> {
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

export const functionService = new FunctionService();
