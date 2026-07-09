import { BellOff } from 'lucide-react';
import type {
  DashboardAdvisorCategory,
  DashboardAdvisorSeverity,
  DashboardAdvisorSuppression,
} from '#types';
import { useToast } from '@insforge/ui';
import { EmptyState } from '#components';
import {
  useAdvisorSuppressions,
  useUnsuppressAdvisorIssue,
} from '#features/dashboard/hooks/useAdvisor';
import { SUPPRESSION_REASON_LABELS } from './suppression';
import { SEVERITY_ICON, SEVERITY_TONE } from './severity';

/**
 * Single source of truth for which suppressions a given (category, severity)
 * filter shows. Used both to render the list and to compute the tab counts in
 * BackendAdvisorSection, so the two never drift.
 *
 * - Category tabs show only their own category; uncategorized rule-level
 *   suppressions (no matching finding in the latest scan) surface only under
 *   "All".
 * - The severity filter applies to rows that carry a severity; uncategorized /
 *   severity-less rows stay visible unless every severity is deselected.
 */
export function selectIgnoredRows(
  rows: DashboardAdvisorSuppression[],
  category: DashboardAdvisorCategory | undefined,
  severities: Set<DashboardAdvisorSeverity>
): DashboardAdvisorSuppression[] {
  if (severities.size === 0) {
    return [];
  }
  return rows.filter(
    (s) => (!category || s.category === category) && (!s.severity || severities.has(s.severity))
  );
}

interface IgnoredListProps {
  category?: DashboardAdvisorCategory;
  selectedSeverities: Set<DashboardAdvisorSeverity>;
}

export function IgnoredList({ category, selectedSeverities }: IgnoredListProps) {
  const suppressions = useAdvisorSuppressions();
  const unsuppress = useUnsuppressAdvisorIssue();
  const { showToast } = useToast();

  const rows = selectIgnoredRows(suppressions.data ?? [], category, selectedSeverities);

  const handleRestore = (id: string) => {
    unsuppress.mutate(id, {
      onSuccess: () => showToast('Issue restored', 'success'),
      onError: (error) => showToast(`Failed to restore: ${error.message}`, 'error'),
    });
  };

  if (suppressions.isLoading) {
    return (
      <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (suppressions.isError) {
    return (
      <div className="flex h-24 items-center justify-center text-sm text-destructive">
        Failed to load ignored issues
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        className="h-32 gap-1"
        title="No ignored issues"
        description="Issues you ignore will show up here"
      />
    );
  }

  return (
    <div className="flex flex-col">
      {rows.map((s) => {
        const severity = s.severity;
        const SeverityIcon = severity ? SEVERITY_ICON[severity] : null;
        return (
          <div
            key={s.id}
            className="flex items-start gap-3 border-b border-[var(--alpha-8)] p-3 last:border-b-0"
          >
            {SeverityIcon && severity ? (
              <SeverityIcon className={`mt-0.5 h-5 w-5 shrink-0 ${SEVERITY_TONE[severity]}`} />
            ) : (
              <BellOff className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="text-sm font-medium leading-5 text-foreground">
                {s.scope === 'rule' ? `All "${s.ruleId}" issues` : (s.title ?? s.ruleId)}
              </p>
              {s.scope === 'instance' && s.affectedObject && (
                <p className="text-xs leading-4 text-muted-foreground">{s.affectedObject}</p>
              )}
              <p className="text-xs leading-4 text-muted-foreground" title={s.note}>
                {SUPPRESSION_REASON_LABELS[s.reason]}
                {' · '}
                {new Date(s.createdAt).toLocaleDateString()}
                {s.note ? ` · ${s.note}` : ''}
              </p>
            </div>
            <button
              type="button"
              disabled={unsuppress.isPending}
              onClick={() => handleRestore(s.id)}
              className="flex shrink-0 items-center rounded border border-[var(--alpha-8)] bg-card px-2 py-1 text-sm text-foreground hover:bg-[var(--alpha-4)] disabled:opacity-50"
            >
              Restore
            </button>
          </div>
        );
      })}
    </div>
  );
}
