import { hasPgErrorCode } from '@/utils/errors.js';
import type {
  AdvisorFinding,
  AdvisorQueryExecutor,
  AdvisorRule,
  AdvisorRuleResultRow,
} from '@/lib/advisor/types.js';

export function mapRuleRows(rule: AdvisorRule, rows: AdvisorRuleResultRow[]): AdvisorFinding[] {
  return rows.map((row, index) => ({
    id: `${rule.id}:${row.affected_object}:${index}`,
    ruleId: rule.id,
    category: rule.category,
    severity: rule.severity,
    title: rule.title,
    description: rule.description,
    detail: row.detail,
    recommendation: row.recommendation,
    affectedObject: row.affected_object,
    metadata: row.metadata ?? {},
  }));
}

export async function runSqlRule(
  rule: AdvisorRule,
  executor: AdvisorQueryExecutor,
  sql: string
): Promise<AdvisorFinding[]> {
  const result = await executor.query<AdvisorRuleResultRow>(sql);
  return mapRuleRows(rule, result.rows);
}

export async function runOptionalPgStatStatementsRule(
  rule: AdvisorRule,
  executor: AdvisorQueryExecutor,
  sql: string
): Promise<AdvisorFinding[]> {
  try {
    return await runSqlRule(rule, executor, sql);
  } catch (error: unknown) {
    if (hasPgErrorCode(error, '42P01') || hasPgErrorCode(error, '42703')) {
      return [];
    }

    throw error;
  }
}
