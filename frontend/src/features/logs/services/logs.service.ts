import { apiClient } from '@/lib/api/client';

export interface LogEntry {
  id: number;
  action: string;
  table_name: string;
  record_id: string | null;
  details: string | null;
  created_at: string;
}

export interface LogsResponse {
  records: LogEntry[];
  total: number;
}

export interface LogsStats {
  actionStats: Array<{ action: string; count: number }>;
  tableStats: Array<{ tableName: string; count: number }>;
  recentActivity: number;
  totalLogs: { count: number };
}

export class LogsService {
  async getLogs(
    limit = 100,
    offset = 0,
    filters?: { action?: string; table?: string }
  ): Promise<LogsResponse> {
    const params = new URLSearchParams({
      limit: limit.toString(),
      offset: offset.toString(),
    });

    if (filters?.action) {
      params.append('action', filters.action);
    }
    if (filters?.table) {
      params.append('table', filters.table);
    }

    const response = await apiClient.request(`/logs?${params.toString()}`, {
      includeHeaders: true,
    });

    // Traditional REST with pagination headers
    if (response.data && Array.isArray(response.data)) {
      return {
        records: response.data,
        total: response.pagination?.totalCount || response.data.length,
      };
    }

    // Fallback for unexpected response
    return {
      records: [],
      total: 0,
    };
  }

  getStats(): Promise<LogsStats> {
    return apiClient.request('/logs/stats');
  }

  clearLogs(before?: string): Promise<{ message: string; deleted: number }> {
    const params = before ? `?before=${before}` : '';
    return apiClient.request(`/logs${params}`, {
      method: 'DELETE',
    });
  }
}

// Analytics types
export interface LogSource {
  id: string;
  name: string;
  token: string;
}

export interface AnalyticsLogRecord {
  id: string;
  event_message: string;
  timestamp: string;
  body: Record<string, any>;
  source?: string; // Added for search results
}

export interface AnalyticsLogResponse {
  source: string;
  logs: AnalyticsLogRecord[];
  total: number;
  page: number;
  pageSize: number;
}

export interface LogSourceStats {
  source: string;
  count: number;
  lastActivity: string;
}

class AnalyticsService {
  // Get all available log sources
  async getLogSources(): Promise<LogSource[]> {
    return apiClient.request('/logs/analytics/sources');
  }

  // Get statistics for all log sources
  async getLogSourceStats(): Promise<LogSourceStats[]> {
    return apiClient.request('/logs/analytics/stats');
  }

  // Get logs from a specific source with timestamp-based pagination
  async getLogsBySource(
    sourceName: string,
    limit = 100,
    beforeTimestamp?: string,
    startTime?: string,
    endTime?: string
  ): Promise<AnalyticsLogResponse> {
    const params = new URLSearchParams({
      limit: limit.toString(),
    });

    if (beforeTimestamp) {
      params.append('before_timestamp', beforeTimestamp);
    }
    if (startTime) {
      params.append('start_time', startTime);
    }
    if (endTime) {
      params.append('end_time', endTime);
    }

    return apiClient.request(`/logs/analytics/${sourceName}?${params.toString()}`);
  }

  // Search across all logs or specific source
  async searchLogs(
    query: string,
    sourceName?: string,
    limit = 100,
    offset = 0
  ): Promise<{
    records: AnalyticsLogRecord[];
    total: number;
  }> {
    const params = new URLSearchParams({
      q: query,
      limit: limit.toString(),
      offset: offset.toString(),
    });

    if (sourceName) {
      params.append('source', sourceName);
    }

    const response = await apiClient.request(`/logs/analytics/search?${params.toString()}`, {
      includeHeaders: true,
    });

    // Handle paginated response
    if (response.data && Array.isArray(response.data)) {
      return {
        records: response.data,
        total: response.pagination?.totalCount || response.data.length,
      };
    }

    return {
      records: [],
      total: 0,
    };
  }
}

export const logsService = new LogsService();
export const analyticsService = new AnalyticsService();
