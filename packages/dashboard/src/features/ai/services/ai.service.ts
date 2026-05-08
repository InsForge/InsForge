import { apiClient } from '#lib/api/client';
import {
  AIModelSchema,
  AIConfigurationSchema,
  CreateAIConfigurationRequest,
  UpdateAIConfigurationRequest,
  AIUsageSummarySchema,
  AIUsageRecordSchema,
  ListAIUsageResponse,
  AIConfigurationWithUsageSchema,
  GatewayConfigResponse,
} from '@insforge/shared-schemas';

export class AIService {
  getModels(): Promise<AIModelSchema[]> {
    return apiClient.request('/ai/models', {
      headers: apiClient.withAccessToken(),
    });
  }

  // AI Configuration endpoints
  async createConfiguration(
    data: CreateAIConfigurationRequest
  ): Promise<{ id: string; message: string }> {
    return apiClient.request('/ai/configurations', {
      method: 'POST',
      headers: apiClient.withAccessToken(),
      body: JSON.stringify(data),
    });
  }

  async listConfigurations(): Promise<AIConfigurationWithUsageSchema[]> {
    return apiClient.request('/ai/configurations', {
      headers: apiClient.withAccessToken(),
    });
  }

  async getConfiguration(id: string): Promise<AIConfigurationSchema> {
    return apiClient.request(`/ai/configurations/${id}`, {
      headers: apiClient.withAccessToken(),
    });
  }

  async updateConfiguration(
    id: string,
    data: UpdateAIConfigurationRequest
  ): Promise<{ message: string }> {
    return apiClient.request(`/ai/configurations/${id}`, {
      method: 'PATCH',
      headers: apiClient.withAccessToken(),
      body: JSON.stringify(data),
    });
  }

  async deleteConfiguration(id: string): Promise<{ message: string }> {
    return apiClient.request(`/ai/configurations/${id}`, {
      method: 'DELETE',
      headers: apiClient.withAccessToken(),
    });
  }

  // AI Usage endpoints
  async getUsageSummary(params?: {
    configId?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<AIUsageSummarySchema> {
    const queryParams = new URLSearchParams();
    if (params?.configId) {
      queryParams.append('configId', params.configId);
    }
    if (params?.startDate) {
      queryParams.append('startDate', params.startDate);
    }
    if (params?.endDate) {
      queryParams.append('endDate', params.endDate);
    }

    const queryString = queryParams.toString();
    const url = `/ai/usage/summary${queryString ? `?${queryString}` : ''}`;

    return apiClient.request(url, {
      headers: apiClient.withAccessToken(),
    });
  }

  async getUsageRecords(params?: {
    startDate?: string;
    endDate?: string;
    limit?: string;
    offset?: string;
  }): Promise<ListAIUsageResponse> {
    const queryParams = new URLSearchParams();
    if (params?.startDate) {
      queryParams.append('startDate', params.startDate);
    }
    if (params?.endDate) {
      queryParams.append('endDate', params.endDate);
    }
    if (params?.limit) {
      queryParams.append('limit', params.limit);
    }
    if (params?.offset) {
      queryParams.append('offset', params.offset);
    }

    const queryString = queryParams.toString();
    const url = `/ai/usage${queryString ? `?${queryString}` : ''}`;

    return apiClient.request(url, {
      headers: apiClient.withAccessToken(),
    });
  }

  async getConfigUsageRecords(
    configId: string,
    params?: {
      startDate?: string;
      endDate?: string;
    }
  ): Promise<AIUsageRecordSchema[]> {
    const queryParams = new URLSearchParams();
    if (params?.startDate) {
      queryParams.append('startDate', params.startDate);
    }
    if (params?.endDate) {
      queryParams.append('endDate', params.endDate);
    }

    const queryString = queryParams.toString();
    const url = `/ai/usage/config/${configId}${queryString ? `?${queryString}` : ''}`;

    return apiClient.request(url, {
      headers: apiClient.withAccessToken(),
    });
  }

  async getRemainingCredits(): Promise<{
    usage: number;
    limit: number | null;
    remaining: number | null;
  }> {
    return apiClient.request('/ai/credits', {
      headers: apiClient.withAccessToken(),
    });
  }

  // AI Gateway BYOK endpoints
  async getGatewayConfig(): Promise<GatewayConfigResponse> {
    return apiClient.request('/ai/gateway/config', {
      headers: apiClient.withAccessToken(),
    });
  }

  async setGatewayBYOKKey(apiKey: string): Promise<{ message: string }> {
    return apiClient.request('/ai/gateway/config', {
      method: 'POST',
      headers: apiClient.withAccessToken(),
      body: JSON.stringify({ apiKey }),
    });
  }

  async removeGatewayBYOKKey(): Promise<{ message: string }> {
    return apiClient.request('/ai/gateway/config', {
      method: 'DELETE',
      headers: apiClient.withAccessToken(),
    });
  }
}

export const aiService = new AIService();
