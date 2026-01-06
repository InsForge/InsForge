import { apiClient } from '@/lib/api/client';

export interface McpUsageRecord {
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
  async getMcpUsage(success: boolean = true, limit: number = 200): Promise<McpUsageRecord[]> {
    const params = new URLSearchParams({
      success: success.toString(),
      limit: limit.toString(),
    });

    const data = (await apiClient.request(`/usage/mcp?${params.toString()}`, {
      headers: apiClient.withAccessToken(),
    })) as McpUsageResponse;

    return data.records || [];
  }
}

export const usageService = new UsageService();
