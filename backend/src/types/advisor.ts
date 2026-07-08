// Backend-only types for the database advisor.

export interface AdvisorSummary {
  // NOTE: `scanId`, `status`, `scanType`, `scannedAt` and `errorMessage` describe
  // the *latest* scan (so the UI can show in-progress/failed state), while
  // `summary` counts come from the latest *completed* scan so a running or failed
  // rescan doesn't blank out the last usable results. When the latest scan is
  // running/failed these therefore refer to two different scans by design.
  scanId: string;
  status: 'running' | 'completed' | 'failed';
  scanType: 'manual' | 'scheduled';
  scannedAt: string;
  errorMessage?: string | null;
  summary: {
    total: number;
    critical: number;
    warning: number;
    info: number;
  };
}

export interface AdvisorIssue {
  id: string;
  ruleId: string;
  severity: 'critical' | 'warning' | 'info';
  category: 'security' | 'performance' | 'health';
  title: string;
  description: string;
  affectedObject?: string;
  recommendation?: string;
}

/**
 * Suppression scope and reason. The `as const` arrays are the single source of
 * truth: route validation iterates them and the union types are derived from
 * them, so adding/removing a value updates both at once.
 */
export const SUPPRESSION_SCOPES = ['instance', 'rule'] as const;
export const SUPPRESSION_REASONS = ['false_positive', 'accepted_risk', 'wont_fix'] as const;

export type AdvisorSuppressionScope = (typeof SUPPRESSION_SCOPES)[number];
export type AdvisorSuppressionReason = (typeof SUPPRESSION_REASONS)[number];

export interface AdvisorSuppression {
  id: string;
  ruleId: string;
  affectedObject?: string;
  scope: AdvisorSuppressionScope;
  reason: AdvisorSuppressionReason;
  note?: string;
  createdBy?: string;
  createdAt: string;
  // Enriched from the latest completed scan when a matching finding exists.
  title?: string;
  severity?: 'critical' | 'warning' | 'info';
  category?: 'security' | 'performance' | 'health';
}
