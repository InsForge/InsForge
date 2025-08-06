// Type definitions for logs

export interface LogRecord {
  id: number;
  action: string;
  table_name: string;
  record_id: string | null;
  details: string | null;
  created_at: string;
}

export interface LogActionStat {
  action: string;
  count: number;
}

export interface LogTableStat {
  table_name: string;
  count: number;
}

export interface LogsStats {
  actionStats: LogActionStat[];
  tableStats: LogTableStat[];
  recentActivity: number;
  totalLogs: number;
}

// Types for Logflare analytics logs
export interface LogSource {
  id: number;
  name: string;
  token: string;
}

export interface AnalyticsLogRecord {
  id: string;
  event_message: string;
  timestamp: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: Record<string, any>;
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
