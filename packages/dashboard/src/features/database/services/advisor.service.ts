import { apiClient } from '#lib/api/client';

export type AdvisorScanStatus = 'completed' | 'completed_with_errors' | 'failed';
export type AdvisorScanType = 'manual' | 'scheduled';
export type AdvisorSeverity = 'critical' | 'warning' | 'info';
export type AdvisorCategory = 'security' | 'performance' | 'health';

export interface AdvisorFinding {
  id: string;
  ruleId: string;
  title: string;
  description: string;
  severity: AdvisorSeverity;
  category: AdvisorCategory;
  affectedObject?: string;
  recommendation?: string;
  metadata?: Record<string, unknown>;
}

export interface AdvisorScanRuleError {
  ruleId: string;
  message: string;
}

export interface AdvisorScanResult {
  scanId: string;
  status: AdvisorScanStatus;
  scanType: AdvisorScanType;
  scannedAt: string;
  summary: {
    total: number;
    critical: number;
    warning: number;
    info: number;
  };
  findings: AdvisorFinding[];
  errors: AdvisorScanRuleError[];
}

class AdvisorService {
  runScan(): Promise<AdvisorScanResult> {
    return apiClient.request('/advisor/scan', {
      method: 'POST',
      headers: apiClient.withAccessToken({
        'Content-Type': 'application/json',
      }),
    });
  }
}

export const advisorService = new AdvisorService();
