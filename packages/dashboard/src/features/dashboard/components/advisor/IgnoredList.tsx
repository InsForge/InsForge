import { BellOff } from 'lucide-react';
import type { DashboardAdvisorCategory } from '#types';
import { useToast } from '@insforge/ui';
import { EmptyState } from '#components';
import {
  useAdvisorSuppressions,
  useUnsuppressAdvisorIssue,
} from '#features/dashboard/hooks/useAdvisor';
import { SUPPRESSION_REASON_LABELS } from './IgnoreMenu';

interface IgnoredListProps {
  category?: DashboardAdvisorCategory;
}

export function IgnoredList({ category }: IgnoredListProps) {
  const suppressions = useAdvisorSuppressions();
  const unsuppress = useUnsuppressAdvisorIssue();
  const { showToast } = useToast();

  const rows = (suppressions.data ?? []).filter(
    (s) => !category || s.category === category || !s.category
  );

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
      {rows.map((s) => (
        <div
          key={s.id}
          className="flex items-start gap-3 border-b border-[var(--alpha-8)] p-3 last:border-b-0"
        >
          <BellOff className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
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
      ))}
    </div>
  );
}
