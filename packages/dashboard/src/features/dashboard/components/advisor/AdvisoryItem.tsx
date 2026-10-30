import { Check, ChevronDown, ChevronUp, Copy } from 'lucide-react';
import type { DashboardAdvisorIssue } from '#types';
import { useToast } from '@insforge/ui';
import { useCopyToClipboard } from '#lib/hooks/useCopyToClipboard';
import { IgnoreMenu } from './IgnoreMenu';
import { formatRemediationPrompt } from './remediationPrompt';
import { SEVERITY_ICON, SEVERITY_TONE } from './severity';

interface AdvisoryItemProps {
  issue: DashboardAdvisorIssue;
  expanded: boolean;
  onToggle: () => void;
}

export function AdvisoryItem({ issue, expanded, onToggle }: AdvisoryItemProps) {
  const { showToast } = useToast();
  const { copied, copy } = useCopyToClipboard();
  const Icon = SEVERITY_ICON[issue.severity];

  const handleCopyRemediation = async () => {
    if (!issue.recommendation) {
      return;
    }
    const ok = await copy(formatRemediationPrompt(issue));
    if (!ok) {
      showToast('Failed to copy remediation', 'error');
    }
  };

  const copyButtonVisibility = expanded
    ? 'opacity-100'
    : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100';

  return (
    <div className="group border-b border-[var(--alpha-8)] transition-colors last:border-b-0 hover:bg-[var(--alpha-8)]">
      <div className="flex items-start gap-3 p-3">
        <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${SEVERITY_TONE[issue.severity]}`} />
        <div className="flex min-w-0 flex-1 items-start gap-6">
          {/* The title area is the expand control; the action buttons live as
              siblings (not nested inside it) so we never place interactive
              controls inside a button. */}
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${issue.title}`}
            onClick={onToggle}
            className="flex min-w-0 flex-1 cursor-pointer flex-col items-start gap-1 text-left"
          >
            <span className="text-sm font-medium leading-5 text-foreground">{issue.title}</span>
            {issue.affectedObject && (
              <span className="text-xs leading-4 text-muted-foreground">
                {issue.affectedObject}
              </span>
            )}
          </button>
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
            <IgnoreMenu issue={issue} visibilityClass={copyButtonVisibility} />
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
