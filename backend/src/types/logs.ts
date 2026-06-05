// Audit log types
export interface AuditLogEntry {
  actor?: string;
  action: string;
  module: string;
  details?: Record<string, unknown>;
  ip_address?: string;
}

export interface AuditLogQuery {
  actor?: string;
  action?: string;
  module?: string;
  start_date?: Date;
  end_date?: Date;
  limit?: number;
  offset?: number;
}
