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
