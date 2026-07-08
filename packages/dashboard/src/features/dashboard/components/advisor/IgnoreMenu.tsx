import { useState } from 'react';
import { EllipsisVertical } from 'lucide-react';
import type {
  DashboardAdvisorIssue,
  DashboardAdvisorSuppressionReason,
  DashboardAdvisorSuppressionScope,
} from '#types';
import {
  useToast,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@insforge/ui';
import { Popover, PopoverTrigger, PopoverContent } from '#components/radix';
import { useSuppressAdvisorIssue } from '#features/dashboard/hooks/useAdvisor';

export const SUPPRESSION_REASON_LABELS: Record<DashboardAdvisorSuppressionReason, string> = {
  false_positive: 'False positive',
  accepted_risk: 'Accepted risk',
  wont_fix: "Won't fix",
};

const REASONS = Object.keys(SUPPRESSION_REASON_LABELS) as DashboardAdvisorSuppressionReason[];

interface IgnoreMenuProps {
  issue: DashboardAdvisorIssue;
  visibilityClass: string;
}

export function IgnoreMenu({ issue, visibilityClass }: IgnoreMenuProps) {
  const [panel, setPanel] = useState<'closed' | 'menu' | DashboardAdvisorSuppressionScope>(
    'closed'
  );
  const [reason, setReason] = useState<DashboardAdvisorSuppressionReason | null>(null);
  const [note, setNote] = useState('');
  const { showToast } = useToast();
  const suppress = useSuppressAdvisorIssue();

  const openForm = (scope: DashboardAdvisorSuppressionScope) => {
    setReason(null);
    setNote('');
    setPanel(scope);
  };

  const handleSubmit = () => {
    if (!reason || panel === 'closed' || panel === 'menu') {
      return;
    }
    suppress.mutate(
      {
        ruleId: issue.ruleId,
        affectedObject: panel === 'instance' ? issue.affectedObject : undefined,
        scope: panel,
        reason,
        note: note.trim() ? note.trim() : undefined,
      },
      {
        onSuccess: () => {
          setPanel('closed');
          showToast('Issue ignored', 'success');
        },
        onError: (error) => {
          showToast(`Failed to ignore: ${error.message}`, 'error');
        },
      }
    );
  };

  const triggerButton = (
    <button
      type="button"
      aria-label="Ignore options"
      className={`flex items-center rounded border border-[var(--alpha-8)] bg-card p-1 text-foreground transition-opacity hover:bg-[var(--alpha-4)] ${visibilityClass}`}
    >
      <EllipsisVertical className="h-5 w-5" />
    </button>
  );

  const isFormOpen = panel === 'instance' || panel === 'rule';

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      {isFormOpen ? (
        <Popover
          open
          onOpenChange={(open) => {
            if (!open) {
              setPanel('closed');
            }
          }}
        >
          <PopoverTrigger asChild>{triggerButton}</PopoverTrigger>
          <PopoverContent align="end" className="w-72 p-3">
            <p className="text-sm font-medium leading-5 text-foreground">
              {panel === 'instance' ? 'Ignore this issue' : `Ignore all "${issue.ruleId}" issues`}
            </p>
            {panel === 'instance' && issue.affectedObject && (
              <p className="mt-0.5 text-xs leading-4 text-muted-foreground">
                {issue.affectedObject}
              </p>
            )}
            <p className="mt-2 text-xs font-medium leading-4 text-muted-foreground">Reason *</p>
            <div className="mt-1 flex flex-col gap-1">
              {REASONS.map((r) => (
                <label
                  key={r}
                  className="flex cursor-pointer items-center gap-2 text-sm text-foreground"
                >
                  <input
                    type="radio"
                    name={`ignore-reason-${issue.id}`}
                    checked={reason === r}
                    onChange={() => setReason(r)}
                  />
                  {SUPPRESSION_REASON_LABELS[r]}
                </label>
              ))}
            </div>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note (optional)"
              maxLength={1000}
              className="mt-2 w-full rounded border border-[var(--alpha-8)] bg-card px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPanel('closed')}
                className="rounded border border-[var(--alpha-8)] bg-card px-2 py-1 text-sm text-foreground hover:bg-[var(--alpha-4)]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!reason || suppress.isPending}
                onClick={handleSubmit}
                className="rounded border border-[var(--alpha-8)] bg-[var(--alpha-8)] px-2 py-1 text-sm text-foreground hover:bg-[var(--alpha-4)] disabled:opacity-50"
              >
                {suppress.isPending ? 'Ignoring…' : 'Ignore'}
              </button>
            </div>
          </PopoverContent>
        </Popover>
      ) : (
        <DropdownMenu
          open={panel === 'menu'}
          onOpenChange={(open) => setPanel(open ? 'menu' : 'closed')}
        >
          <DropdownMenuTrigger asChild>{triggerButton}</DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64 p-1">
            <DropdownMenuItem
              disabled={!issue.affectedObject}
              onSelect={(e) => {
                e.preventDefault();
                openForm('instance');
              }}
            >
              Ignore this issue
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                openForm('rule');
              }}
            >
              {`Ignore all "${issue.ruleId}" issues`}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
