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

export type McpConnectionStatus = 'connected' | 'disconnected';

export interface McpConnectionStatusResponse {
  status: McpConnectionStatus;
}

export class UsageService {
  /**
   * Get the current MCP connection status
   */
  async getMcpConnectionStatus(signal?: AbortSignal): Promise<McpConnectionStatus> {
    const data = (await apiClient.request('/usage/mcp/status', {
      headers: apiClient.withAccessToken(),
      signal,
    })) as McpConnectionStatusResponse;

    return data.status ?? 'disconnected';
  }

  /**
   * Get MCP usage records
   */
  async getMcpUsage(
    success: boolean | null = true,
    limit: number = 200,
    signal?: AbortSignal
  ): Promise<McpUsageRecord[]> {
    const params = new URLSearchParams({
      limit: limit.toString(),
    });
    if (success !== null) {
      params.append('success', success.toString());
    }

    const data = (await apiClient.request(`/usage/mcp?${params.toString()}`, {
      headers: apiClient.withAccessToken(),
      signal,
    })) as McpUsageResponse;

    return data.records || [];
  }
}

export const usageService = new UsageService();
