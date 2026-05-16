import { randomUUID } from 'crypto';
import { AppError } from '@/api/middlewares/error.js';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { advisorRules } from '@/lib/advisor/rules/index.js';
import type { AdvisorFinding, AdvisorScanResult, AdvisorScanSummary } from '@/lib/advisor/types.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import logger from '@/utils/logger.js';

export class AdvisorService {
  private static instance: AdvisorService;
  private isScanRunning = false;

  static getInstance(): AdvisorService {
    if (!AdvisorService.instance) {
      AdvisorService.instance = new AdvisorService();
    }

    return AdvisorService.instance;
  }

  async runScan(): Promise<AdvisorScanResult> {
    if (this.isScanRunning) {
      throw new AppError('Advisor scan already running', 409, ERROR_CODES.TOO_MANY_REQUESTS);
    }

    this.isScanRunning = true;
    const scanId = randomUUID();
    const scannedAt = new Date().toISOString();
    const pool = DatabaseManager.getInstance().getPool();
    const findings: AdvisorFinding[] = [];
    const errors: AdvisorScanResult['errors'] = [];

    try {
      for (const rule of advisorRules) {
        try {
          findings.push(...(await rule.run(pool)));
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Unknown advisor rule error';
          logger.warn('Advisor rule failed', {
            ruleId: rule.id,
            error: message,
          });
          errors.push({
            ruleId: rule.id,
            message,
          });
        }
      }

      return {
        scanId,
        status: errors.length > 0 ? 'completed_with_errors' : 'completed',
        scanType: 'manual',
        scannedAt,
        summary: this.buildSummary(findings),
        findings,
        errors,
      };
    } finally {
      this.isScanRunning = false;
    }
  }

  private buildSummary(findings: AdvisorFinding[]): AdvisorScanSummary {
    return findings.reduce<AdvisorScanSummary>(
      (summary, finding) => {
        summary.total += 1;
        summary[finding.severity] += 1;
        return summary;
      },
      {
        total: 0,
        critical: 0,
        warning: 0,
        info: 0,
      }
    );
  }
}
