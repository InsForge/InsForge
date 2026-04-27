import { useState } from 'react';
import { ChevronDown, ChevronUp, Copy } from 'lucide-react';
import type { DashboardAdvisorIssue } from '../../../../types';
import { useToast } from '../../../../lib/hooks/useToast';
import CriticalIcon from '../../../../assets/icons/severity_critical.svg?react';
import InfoIcon from '../../../../assets/icons/severity_info.svg?react';
import WarningIcon from '../../../../assets/icons/severity_warning.svg?react';

interface AdvisoryItemProps {
  issue: DashboardAdvisorIssue;
}

const SEVERITY_ICON = {
  critical: CriticalIcon,
  warning: WarningIcon,
  info: InfoIcon,
} as const;

const SEVERITY_TONE = {
  critical: 'text-destructive',
  warning: 'text-warning',
  info: 'text-info',
} as const;

export function AdvisoryItem({ issue }: AdvisoryItemProps) {
  const [expanded, setExpanded] = useState(false);
  const { showToast } = useToast();
  const Icon = SEVERITY_ICON[issue.severity];

  const handleCopyRemediation = async () => {
    if (!issue.recommendation) {
      return;
    }
    try {
      await navigator.clipboard.writeText(issue.recommendation);
      showToast('Remediation copied', 'success');
    } catch {
      showToast('Failed to copy remediation', 'error');
    }
  };

  const copyButtonVisibility = expanded
    ? 'opacity-100'
    : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100';

  return (
    <div className="group border-b border-[var(--alpha-8)] last:border-b-0">
      <div className="flex items-start gap-3 p-3">
        <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${SEVERITY_TONE[issue.severity]}`} />
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="flex flex-col gap-2">
            <div className="flex items-start gap-6">
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <p className="font-mono text-xs leading-4 text-muted-foreground">{issue.ruleId}</p>
                <p className="text-sm font-medium leading-5 text-foreground">{issue.title}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {issue.recommendation && (
                  <button
                    type="button"
                    onClick={() => void handleCopyRemediation()}
                    className={`flex items-center gap-1 rounded border border-[var(--alpha-8)] bg-card px-1 py-1 text-sm leading-5 text-foreground transition-opacity hover:bg-[var(--alpha-4)] ${copyButtonVisibility}`}
                  >
                    <Copy className="h-5 w-5" />
                    <span className="px-1">Copy Remediation</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  aria-label={expanded ? 'Collapse' : 'Expand'}
                  aria-expanded={expanded}
                  className="flex h-5 w-5 items-center justify-center text-muted-foreground hover:text-foreground"
                >
                  {expanded ? (
                    <ChevronUp className="h-5 w-5" />
                  ) : (
                    <ChevronDown className="h-5 w-5" />
                  )}
                </button>
              </div>
            </div>
            <p
              className={`text-sm leading-5 text-muted-foreground ${
                expanded ? 'whitespace-pre-wrap' : 'truncate'
              }`}
            >
              {issue.description}
            </p>
          </div>

          {issue.affectedObject && (
            <div className="flex items-center gap-1">
              <span className="text-xs leading-4 text-muted-foreground">Affected:</span>
              <span className="rounded bg-[var(--alpha-8)] px-2 py-0.5 text-xs font-medium leading-4 text-muted-foreground">
                {issue.affectedObject}
              </span>
            </div>
          )}

          {expanded && issue.recommendation && (
            <div className="flex flex-col gap-2 rounded border border-[var(--alpha-8)] bg-semantic-1 p-3">
              <span className="self-start rounded bg-[var(--alpha-8)] px-2 py-0.5 text-xs font-medium leading-4 text-muted-foreground">
                Remediation
              </span>
              <pre className="whitespace-pre-wrap font-mono text-sm leading-6 text-foreground">
                {issue.recommendation}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
