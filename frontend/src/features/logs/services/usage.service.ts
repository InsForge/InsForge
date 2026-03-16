import { apiClient } from '@/lib/api/client';

export interface McpUsageRecord {
  id?: string;
  tool_name: string;
  success: boolean;
  created_at: string;
}

export interface McpUsagePage {
  records: McpUsageRecord[];
  total: number;
}

export class UsageService {
  /**
   * Get paginated MCP usage records
   */
  async getMcpUsage(
    success: boolean | null = null,
    page: number = 1,
    pageSize: number = 50,
    toolName?: string
  ): Promise<McpUsagePage> {
    const offset = (page - 1) * pageSize;
    const params = new URLSearchParams({
      limit: pageSize.toString(),
      offset: offset.toString(),
    });
    if (success !== null) {
      params.append('success', success.toString());
    }
    if (toolName) {
      params.append('tool_name', toolName);
    }

    const data = (await apiClient.request(`/usage/mcp?${params.toString()}`, {
      headers: apiClient.withAccessToken(),
    })) as McpUsagePage;

    return { records: data.records || [], total: data.total ?? 0 };
  }
}

export const usageService = new UsageService();
