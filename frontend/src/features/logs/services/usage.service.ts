import { apiClient } from '@/lib/api/client';
import { McpUsageRecord, GetMcpUsageResponse } from '@insforge/shared-schemas';

export class UsageService {
  /**
   * Get MCP usage records
   */
  async getMcpUsage(success: boolean = true, limit: number = 200): Promise<McpUsageRecord[]> {
    const params = new URLSearchParams({
      success: success.toString(),
      limit: limit.toString(),
    });

    const data = (await apiClient.request(`/usage/mcp?${params.toString()}`, {
      headers: apiClient.withAccessToken(),
    })) as GetMcpUsageResponse;

    return data.records || [];
  }
}

export const usageService = new UsageService();
