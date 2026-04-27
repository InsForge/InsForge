import type { DashboardAdvisorSummary } from '../../../../types';
import CriticalIcon from '../../../../assets/icons/severity_critical.svg?react';
import InfoIcon from '../../../../assets/icons/severity_info.svg?react';
import WarningIcon from '../../../../assets/icons/severity_warning.svg?react';

interface SeveritySummaryProps {
  summary?: DashboardAdvisorSummary['summary'];
}

const TILES = [
  {
    key: 'critical' as const,
    label: 'Critical',
    Icon: CriticalIcon,
    iconColor: 'text-destructive',
    iconBg: 'bg-destructive/20',
  },
  {
    key: 'warning' as const,
    label: 'Warnings',
    Icon: WarningIcon,
    iconColor: 'text-warning',
    iconBg: 'bg-warning/20',
  },
  {
    key: 'info' as const,
    label: 'Info',
    Icon: InfoIcon,
    iconColor: 'text-info',
    iconBg: 'bg-info/20',
  },
];

export function SeveritySummary({ summary }: SeveritySummaryProps) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {TILES.map(({ key, label, Icon, iconColor, iconBg }) => (
        <div
          key={key}
          className="flex items-center gap-3 rounded border border-[var(--alpha-8)] bg-card p-4"
        >
          <div className={`flex h-12 w-12 items-center justify-center rounded ${iconBg}`}>
            <Icon className={`h-5 w-5 ${iconColor}`} />
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[13px] leading-[18px] text-muted-foreground">{label}</span>
            <span className="text-xl font-medium leading-7 text-foreground">
              {summary ? summary[key] : 0}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
