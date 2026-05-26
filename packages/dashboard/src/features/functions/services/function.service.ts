import { apiClient } from '#lib/api/client';
import {
  FunctionSchema,
  ListFunctionsResponse,
  UpdateFunctionRequest,
  FunctionResponse,
} from '@insforge/shared-schemas';

export class FunctionService {
  async listFunctions(): Promise<ListFunctionsResponse> {
    const response: ListFunctionsResponse = await apiClient.request('/functions', {
      headers: apiClient.withAccessToken(),
    });

    return {
      functions: Array.isArray(response.functions) ? response.functions : [],
      runtime: response.runtime || { status: 'unavailable' },
      deploymentUrl: response.deploymentUrl ?? null,
    };
  }

  async getFunctionBySlug(slug: string): Promise<FunctionSchema> {
    const response: FunctionSchema = await apiClient.request(`/functions/${slug}`, {
      headers: apiClient.withAccessToken(),
    });
    return response;
  }

  async updateFunction(slug: string, updates: UpdateFunctionRequest): Promise<FunctionResponse> {
    const response: FunctionResponse = await apiClient.request(`/functions/${slug}`, {
      method: 'PUT',
      headers: apiClient.withAccessToken(),
      body: JSON.stringify(updates),
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
