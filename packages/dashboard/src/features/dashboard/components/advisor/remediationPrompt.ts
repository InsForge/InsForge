import type { DashboardAdvisorIssue } from '#types';

function formatIssueBody(issue: DashboardAdvisorIssue): string[] {
  const lines: string[] = [`Rule: ${issue.ruleId}`, `Title: ${issue.title}`];
  if (issue.affectedObject) {
    lines.push(`Affected: ${issue.affectedObject}`);
  }
  lines.push('', 'Description:', issue.description);
  if (issue.recommendation) {
    lines.push('', 'Suggested fix:', issue.recommendation);
  }
  return lines;
}

export function formatRemediationPrompt(issue: DashboardAdvisorIssue): string {
  const header = `InsForge Backend Advisor flagged a [${issue.severity} ${issue.category}] issue:`;
  return [header, '', ...formatIssueBody(issue)].join('\n');
}

export function formatRemediationPromptBatch(issues: DashboardAdvisorIssue[]): string {
  if (issues.length === 0) {
    return '';
  }
  if (issues.length === 1) {
    return formatRemediationPrompt(issues[0]);
  }

  const header = `InsForge Backend Advisor flagged ${issues.length} issues that need attention.`;
  const blocks = issues.map((issue, i) => {
    const counter = `Issue ${i + 1} of ${issues.length} — [${issue.severity} ${issue.category}]`;
    return [counter, '', ...formatIssueBody(issue)].join('\n');
  });
  return [header, ...blocks].join('\n\n---\n\n');
}
