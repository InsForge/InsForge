import { ChevronDown } from 'lucide-react';
import { Checkbox, DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@insforge/ui';
import type { DashboardAdvisorSeverity } from '#types';

const SEVERITIES: Array<{ value: DashboardAdvisorSeverity; label: string }> = [
  { value: 'critical', label: 'Critical' },
  { value: 'warning', label: 'Warning' },
  { value: 'info', label: 'Info' },
];

interface SeverityFilterDropdownProps {
  selected: Set<DashboardAdvisorSeverity>;
  onChange: (next: Set<DashboardAdvisorSeverity>) => void;
}

export function SeverityFilterDropdown({ selected, onChange }: SeverityFilterDropdownProps) {
  const toggle = (severity: DashboardAdvisorSeverity) => {
    const next = new Set(selected);
    if (next.has(severity)) {
      next.delete(severity);
    } else {
      next.add(severity);
    }
    onChange(next);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-8 items-center gap-1 rounded border border-[var(--alpha-8)] bg-card px-2 text-sm leading-5 text-foreground transition-colors hover:bg-[var(--alpha-4)]"
        >
          <span className="text-muted-foreground">Severity:</span>
          <span>{selected.size} selected</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[160px] p-1">
        {SEVERITIES.map((severity) => {
          const isChecked = selected.has(severity.value);
          return (
            <button
              key={severity.value}
              type="button"
              onClick={() => toggle(severity.value)}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm leading-5 text-foreground hover:bg-[var(--alpha-4)]"
            >
              <Checkbox
                checked={isChecked}
                onCheckedChange={() => toggle(severity.value)}
                onClick={(e) => e.stopPropagation()}
              />
              <span>{severity.label}</span>
            </button>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
