import { useState } from 'react';
import { EllipsisVertical } from 'lucide-react';
import type {
  DashboardAdvisorIssue,
  DashboardAdvisorSuppressionReason,
  DashboardAdvisorSuppressionScope,
} from '#types';
import {
  useToast,
  Button,
  Input,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@insforge/ui';
import { useSuppressAdvisorIssue } from '#features/dashboard/hooks/useAdvisor';
import { SUPPRESSION_REASON_LABELS, SUPPRESSION_REASONS } from './suppression';

interface IgnoreMenuProps {
  issue: DashboardAdvisorIssue;
  visibilityClass: string;
}

export function IgnoreMenu({ issue, visibilityClass }: IgnoreMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [formScope, setFormScope] = useState<DashboardAdvisorSuppressionScope | null>(null);
  const [reason, setReason] = useState<DashboardAdvisorSuppressionReason | null>(null);
  const [note, setNote] = useState('');
  const { showToast } = useToast();
  const suppress = useSuppressAdvisorIssue();

  const openForm = (scope: DashboardAdvisorSuppressionScope) => {
    setReason(null);
    setNote('');
    setFormScope(scope);
  };

  const closeForm = () => setFormScope(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason || formScope === null) {
      return;
    }
    suppress.mutate(
      {
        ruleId: issue.ruleId,
        affectedObject: formScope === 'instance' ? issue.affectedObject : undefined,
        scope: formScope,
        reason,
        note: note.trim() ? note.trim() : undefined,
      },
      {
        onSuccess: () => {
          closeForm();
          showToast('Issue ignored', 'success');
        },
        onError: (error) => {
          showToast(`Failed to ignore: ${error.message}`, 'error');
        },
      }
    );
  };

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Ignore options for ${issue.ruleId}${
              issue.affectedObject ? ` (${issue.affectedObject})` : ''
            }`}
            className={`flex items-center rounded border border-[var(--alpha-8)] bg-card p-1 text-foreground transition-opacity hover:bg-[var(--alpha-4)] ${visibilityClass}`}
          >
            <EllipsisVertical className="h-5 w-5" />
          </button>
        </DropdownMenuTrigger>
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

      <Dialog open={formScope !== null} onOpenChange={(open) => !open && closeForm()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {formScope === 'rule' ? `Ignore all "${issue.ruleId}" issues` : 'Ignore this issue'}
            </DialogTitle>
            <DialogDescription>
              {formScope === 'instance' && issue.affectedObject
                ? issue.affectedObject
                : "Ignored issues move to the Ignored view and won't count toward active findings."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <DialogBody className="gap-4">
              <div className="flex items-start gap-3">
                <span className="w-28 shrink-0 pt-1 text-sm font-medium text-foreground">
                  Reason
                </span>
                <div className="flex flex-1 flex-col gap-2">
                  {SUPPRESSION_REASONS.map((r) => (
                    <label key={r} className="flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        name={`ignore-reason-${issue.id}`}
                        value={r}
                        checked={reason === r}
                        onChange={() => setReason(r)}
                        disabled={suppress.isPending}
                        className="accent-primary"
                      />
                      <span className="text-sm">{SUPPRESSION_REASON_LABELS[r]}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex items-start gap-3">
                <span className="w-28 shrink-0 pt-2 text-sm font-medium text-foreground">Note</span>
                <div className="flex-1">
                  <Input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Optional"
                    maxLength={1000}
                    disabled={suppress.isPending}
                  />
                </div>
              </div>
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={closeForm}>
                Cancel
              </Button>
              <Button type="submit" disabled={!reason || suppress.isPending}>
                {suppress.isPending ? 'Ignoring…' : 'Ignore'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
