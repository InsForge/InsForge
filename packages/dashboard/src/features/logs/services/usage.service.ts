import { apiClient } from '#lib/api/client';

export interface McpUsageRecord {
  id?: string;
  tool_name: string;
  success: boolean;
  created_at: string;
}

export interface McpUsageResponse {
  records: McpUsageRecord[];
}

export class UsageService {
  /**
   * Get MCP usage records
   */
  async getMcpUsage(
    success: boolean | null = true,
    limit: number = 200
  ): Promise<McpUsageRecord[]> {
    const params = new URLSearchParams({
      limit: limit.toString(),
    });
    if (success !== null) {
      params.append('success', success.toString());
    }

    const data = (await apiClient.request(`/usage/mcp?${params.toString()}`, {
      headers: apiClient.withAccessToken(),
    })) as McpUsageResponse;

    return data.records || [];
  }
}

export const usageService = new UsageService();
