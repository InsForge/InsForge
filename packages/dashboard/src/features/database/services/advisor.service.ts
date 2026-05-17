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
  getLatestScan(): Promise<AdvisorScanResult | null> {
    return apiClient.request('/advisor/latest');
  }

  listIssues(params: {
    category?: AdvisorCategory;
    severity?: AdvisorSeverity;
    limit?: number;
    offset?: number;
  }): Promise<{ issues: AdvisorFinding[]; total: number }> {
    const searchParams = new URLSearchParams();
    if (params.category) {
      searchParams.set('category', params.category);
    }
    if (params.severity) {
      searchParams.set('severity', params.severity);
    }
    if (params.limit !== undefined) {
      searchParams.set('limit', String(params.limit));
    }
    if (params.offset !== undefined) {
      searchParams.set('offset', String(params.offset));
    }

    const query = searchParams.toString();
    return apiClient.request(`/advisor/issues${query ? `?${query}` : ''}`);
  }

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
