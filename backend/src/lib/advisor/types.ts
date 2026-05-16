import type { QueryResultRow } from 'pg';

export type AdvisorCategory = 'security' | 'performance' | 'health';

export type AdvisorSeverity = 'critical' | 'warning' | 'info';

export interface AdvisorQueryExecutor {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[]
  ): Promise<{ rows: T[] }>;
}

export interface AdvisorFinding {
  ruleId: string;
  category: AdvisorCategory;
  severity: AdvisorSeverity;
  title: string;
  description: string;
  detail: string;
  recommendation: string;
  affectedObject: string;
  metadata: Record<string, unknown>;
}

export interface AdvisorRule {
  id: string;
  category: AdvisorCategory;
  severity: AdvisorSeverity;
  title: string;
  description: string;
  run: (executor: AdvisorQueryExecutor) => Promise<AdvisorFinding[]>;
}

export interface AdvisorRuleResultRow extends QueryResultRow {
  affected_object: string;
  detail: string;
  recommendation: string;
  metadata: Record<string, unknown> | null;
}

export interface AdvisorScanSummary {
  total: number;
  critical: number;
  warning: number;
  info: number;
}

export interface AdvisorScanRuleError {
  ruleId: string;
  message: string;
}

export interface AdvisorScanResult {
  scanId: string;
  status: 'completed' | 'completed_with_errors';
  scanType: 'manual';
  scannedAt: string;
  summary: AdvisorScanSummary;
  findings: AdvisorFinding[];
  errors: AdvisorScanRuleError[];
}
