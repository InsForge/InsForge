import { Badge } from '@insforge/ui';
import type { DashboardAdvisorCategory } from '../../../../types';

export type AdvisoryTabValue = 'all' | DashboardAdvisorCategory;

interface AdvisoryTabsProps {
  value: AdvisoryTabValue;
  onChange: (value: AdvisoryTabValue) => void;
  totalCount?: number;
  categoryCounts?: Record<DashboardAdvisorCategory, number>;
}

const TABS: Array<{ value: AdvisoryTabValue; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'security', label: 'Security' },
  { value: 'performance', label: 'Performance' },
  { value: 'health', label: 'Health' },
];

export function AdvisoryTabs({ value, onChange, totalCount, categoryCounts }: AdvisoryTabsProps) {
  return (
    <div role="tablist" className="flex items-center gap-1">
      {TABS.map((tab) => {
        const count =
          tab.value === 'all' ? totalCount : categoryCounts ? categoryCounts[tab.value] : undefined;
        const isActive = value === tab.value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.value)}
            className={`flex h-8 items-center gap-1.5 rounded px-2 text-sm leading-5 transition-colors ${
              isActive
                ? 'bg-toast text-foreground'
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
