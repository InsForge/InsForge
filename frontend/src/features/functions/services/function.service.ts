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

export interface FunctionsResponse {
  functions: EdgeFunction[];
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

export const functionService = new FunctionService();
