import { useState } from 'react';
import { Check, ChevronDown, ChevronUp, Copy } from 'lucide-react';
import type { DashboardAdvisorIssue } from '../../../../types';
import { useToast } from '../../../../lib/hooks/useToast';
import { formatRemediationPrompt } from './remediationPrompt';
import CriticalIcon from '../../../../assets/icons/severity_critical.svg?react';
import InfoIcon from '../../../../assets/icons/severity_info.svg?react';
import WarningIcon from '../../../../assets/icons/severity_warning.svg?react';

interface AdvisoryItemProps {
  issue: DashboardAdvisorIssue;
  expanded: boolean;
  onToggle: () => void;
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

export function AdvisoryItem({ issue, expanded, onToggle }: AdvisoryItemProps) {
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);
  const Icon = SEVERITY_ICON[issue.severity];

  const handleCopyRemediation = async () => {
    if (!issue.recommendation) {
      return;
    }
    try {
      await navigator.clipboard.writeText(formatRemediationPrompt(issue));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('Failed to copy remediation', 'error');
    }
  };

  const copyButtonVisibility =
    expanded || copied
      ? 'opacity-100'
      : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100';

  return (
    <div className="group border-b border-[var(--alpha-8)] transition-colors last:border-b-0 hover:bg-[var(--alpha-8)]">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) {
            return;
          }
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
        className="flex cursor-pointer items-start gap-3 p-3"
      >
        <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${SEVERITY_TONE[issue.severity]}`} />
        <div className="flex min-w-0 flex-1 items-start gap-6">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="text-sm font-medium leading-5 text-foreground">{issue.title}</p>
            {issue.affectedObject && (
              <p className="text-xs leading-4 text-muted-foreground">{issue.affectedObject}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {issue.recommendation && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void handleCopyRemediation();
                }}
                className={`flex items-center gap-1 rounded border border-[var(--alpha-8)] bg-card px-1 py-1 text-sm leading-5 text-foreground transition-opacity hover:bg-[var(--alpha-4)] ${copyButtonVisibility}`}
              >
                {copied ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
                <span className="px-1">{copied ? 'Copied' : 'Copy Remediation'}</span>
              </button>
            )}
            <span
              aria-hidden="true"
              className="flex h-5 w-5 items-center justify-center text-muted-foreground"
            >
              {expanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
            </span>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="flex flex-col gap-3 px-3 pb-3 pl-11">
          <p className="whitespace-pre-wrap text-sm leading-5 text-muted-foreground">
            {issue.description}
          </p>
          {issue.recommendation && (
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
      )}
    </div>
  );
}
