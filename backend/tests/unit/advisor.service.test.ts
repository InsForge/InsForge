import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AdvisorCategory,
  AdvisorFinding,
  AdvisorQueryExecutor,
  AdvisorRule,
  AdvisorScanResult,
  AdvisorSeverity,
} from '../../src/lib/advisor/types.js';

const { mockAdvisorRules, mockLogger, mockPool } = vi.hoisted(() => ({
  mockAdvisorRules: [] as AdvisorRule[],
  mockLogger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
  mockPool: {
    query: vi.fn(),
  } as unknown as AdvisorQueryExecutor,
}));

vi.mock('@/infra/database/database.manager.js', () => ({
  DatabaseManager: {
    getInstance: vi.fn(() => ({
      getPool: vi.fn(() => mockPool),
    })),
  },
}));

vi.mock('@/lib/advisor/rules/index.js', () => ({
  advisorRules: mockAdvisorRules,
}));

vi.mock('@/utils/logger.js', () => ({
  default: mockLogger,
}));

import { AdvisorService } from '../../src/services/advisor/advisor.service.js';

function makeFinding(
  ruleId: string,
  severity: AdvisorSeverity,
  category: AdvisorCategory = 'security'
): AdvisorFinding {
  return {
    id: `${ruleId}:public.orders:0`,
    ruleId,
    category,
    severity,
    title: `${ruleId} title`,
    description: `${ruleId} description`,
    detail: `${ruleId} detail`,
    recommendation: `${ruleId} recommendation`,
    affectedObject: 'public.orders',
    metadata: { ruleId },
  };
}

function makeRule(
  id: string,
  severity: AdvisorSeverity,
  findings: AdvisorFinding[],
  category: AdvisorCategory = 'security'
): AdvisorRule {
  return {
    id,
    category,
    severity,
    title: `${id} title`,
    description: `${id} description`,
    run: vi.fn(async () => findings),
  };
}

function makeFailingRule(id: string, error: Error): AdvisorRule {
  return {
    id,
    category: 'performance',
    severity: 'warning',
    title: `${id} title`,
    description: `${id} description`,
    run: vi.fn(async () => {
      throw error;
    }),
  };
}

describe('AdvisorService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdvisorRules.length = 0;
    const serviceState = AdvisorService.getInstance() as unknown as {
      isScanRunning: boolean;
      latestScanResult: AdvisorScanResult | null;
    };
    serviceState.isScanRunning = false;
    serviceState.latestScanResult = null;
  });

  it('runs all advisor rules and summarizes returned findings', async () => {
    const criticalFinding = makeFinding('critical-rule', 'critical');
    const warningFinding = makeFinding('warning-rule', 'warning', 'performance');
    const infoFinding = makeFinding('info-rule', 'info', 'health');
    const criticalRule = makeRule('critical-rule', 'critical', [criticalFinding]);
    const warningRule = makeRule('warning-rule', 'warning', [warningFinding], 'performance');
    const infoRule = makeRule('info-rule', 'info', [infoFinding], 'health');
    mockAdvisorRules.push(criticalRule, warningRule, infoRule);

    const result = await AdvisorService.getInstance().runScan();

    expect(criticalRule.run).toHaveBeenCalledWith(mockPool);
    expect(warningRule.run).toHaveBeenCalledWith(mockPool);
    expect(infoRule.run).toHaveBeenCalledWith(mockPool);
    expect(result).toEqual(
      expect.objectContaining({
        status: 'completed',
        scanType: 'manual',
        summary: {
          total: 3,
          critical: 1,
          warning: 1,
          info: 1,
        },
        findings: [criticalFinding, warningFinding, infoFinding],
        errors: [],
      })
    );
    expect(result.scanId).toEqual(expect.any(String));
    expect(result.scannedAt).toEqual(expect.any(String));
    expect(AdvisorService.getInstance().getLatestScan()).toBe(result);
  });

  it('continues scanning when one rule fails and reports the rule error', async () => {
    const finding = makeFinding('ok-rule', 'info', 'health');
    const okRule = makeRule('ok-rule', 'info', [finding], 'health');
    const failingRule = makeFailingRule('bad-rule', new Error('query failed'));
    mockAdvisorRules.push(okRule, failingRule);

    const result = await AdvisorService.getInstance().runScan();

    expect(result.status).toBe('completed_with_errors');
    expect(result.findings).toEqual([finding]);
    expect(result.summary).toEqual({
      total: 1,
      critical: 0,
      warning: 0,
      info: 1,
    });
    expect(result.errors).toEqual([{ ruleId: 'bad-rule', message: 'query failed' }]);
    expect(mockLogger.warn).toHaveBeenCalledWith('Advisor rule failed', {
      ruleId: 'bad-rule',
      error: 'query failed',
    });
  });

  it('rejects a second scan while another scan is running', async () => {
    let resolveScan!: (findings: AdvisorFinding[]) => void;
    const pendingScan = new Promise<AdvisorFinding[]>((resolve) => {
      resolveScan = resolve;
    });
    const slowRule: AdvisorRule = {
      id: 'slow-rule',
      category: 'performance',
      severity: 'warning',
      title: 'slow-rule title',
      description: 'slow-rule description',
      run: vi.fn(() => pendingScan),
    };
    mockAdvisorRules.push(slowRule);

    const firstScan = AdvisorService.getInstance().runScan();

    await expect(AdvisorService.getInstance().runScan()).rejects.toMatchObject({
      message: 'Advisor scan already running',
      statusCode: 409,
    });

    resolveScan([]);
    await expect(firstScan).resolves.toEqual(
      expect.objectContaining({
        status: 'completed',
        findings: [],
        errors: [],
      })
    );
  });

  it('filters latest advisor issues by category and severity with pagination', async () => {
    const criticalFinding = makeFinding('critical-rule', 'critical', 'security');
    const warningFinding = makeFinding('warning-rule', 'warning', 'performance');
    const secondWarningFinding = {
      ...makeFinding('second-warning-rule', 'warning', 'performance'),
      id: 'second-warning-rule:public.orders:0',
    };
    mockAdvisorRules.push(
      makeRule('critical-rule', 'critical', [criticalFinding], 'security'),
      makeRule('warning-rule', 'warning', [warningFinding], 'performance'),
      makeRule('second-warning-rule', 'warning', [secondWarningFinding], 'performance')
    );

    await AdvisorService.getInstance().runScan();

    expect(
      AdvisorService.getInstance().listIssues({
        category: 'performance',
        severity: 'warning',
        limit: 1,
        offset: 1,
      })
    ).toEqual({
      issues: [secondWarningFinding],
      total: 2,
    });
  });

  it('returns an empty issue list before the first scan', () => {
    expect(
      AdvisorService.getInstance().listIssues({
        limit: 50,
        offset: 0,
      })
    ).toEqual({
      issues: [],
      total: 0,
    });
  });
});
