import type { DashboardAdvisorSuppressionReason } from '#types';

export const SUPPRESSION_REASON_LABELS: Record<DashboardAdvisorSuppressionReason, string> = {
  false_positive: 'False positive',
  accepted_risk: 'Accepted risk',
  wont_fix: "Won't fix",
  other: 'Other',
};

export const SUPPRESSION_REASONS = Object.keys(
  SUPPRESSION_REASON_LABELS
) as DashboardAdvisorSuppressionReason[];
