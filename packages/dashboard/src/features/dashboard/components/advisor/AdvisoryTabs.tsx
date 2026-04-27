import { Badge } from '@insforge/ui';
import type { DashboardAdvisorSeverity, DashboardAdvisorSummary } from '../../../../types';

export type AdvisoryTabValue = 'all' | DashboardAdvisorSeverity;

interface AdvisoryTabsProps {
  value: AdvisoryTabValue;
  onChange: (value: AdvisoryTabValue) => void;
  summary?: DashboardAdvisorSummary['summary'];
}

const TABS: Array<{
  value: AdvisoryTabValue;
  label: string;
  key?: keyof NonNullable<AdvisoryTabsProps['summary']>;
}> = [
  { value: 'all', label: 'All', key: 'total' },
  { value: 'critical', label: 'Critical', key: 'critical' },
  { value: 'warning', label: 'Warnings', key: 'warning' },
  { value: 'info', label: 'Info', key: 'info' },
];

export function AdvisoryTabs({ value, onChange, summary }: AdvisoryTabsProps) {
  return (
    <div role="tablist" className="flex border-b border-[var(--alpha-8)]">
      {TABS.map((tab) => {
        const count = summary && tab.key ? summary[tab.key] : undefined;
        const isActive = value === tab.value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.value)}
            className={`flex h-9 items-center gap-2 px-3 text-sm transition-colors ${
              isActive
                ? 'border-b-2 border-primary text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
            {typeof count === 'number' && (
              <Badge variant="default" className="h-5 rounded px-1.5 text-xs">
                {count}
              </Badge>
            )}
          </button>
        );
      })}
    </div>
  );
}
