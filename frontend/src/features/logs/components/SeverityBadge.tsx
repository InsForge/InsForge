import { SEVERITY_CONFIG, type SeverityType } from '../helpers';
import { cn } from '@/lib/utils/utils';

interface SeverityBadgeProps {
  severity: SeverityType;
}

export function SeverityBadge({ severity }: SeverityBadgeProps) {
  const config = SEVERITY_CONFIG[severity] || SEVERITY_CONFIG.informational;
  const badgeClass =
    severity === 'error'
      ? 'border-red-500/30 bg-red-500/12 text-red-300'
      : severity === 'warning'
        ? 'border-yellow-500/30 bg-yellow-500/12 text-yellow-300'
        : 'border-[var(--alpha-8)] bg-[var(--alpha-8)] text-[rgb(var(--muted-foreground))]';

  return (
    <span
      className={cn(
        'inline-flex h-5 items-center rounded px-2 text-[12px] font-medium leading-4 border',
        badgeClass
      )}
      title={config.label}
    >
      {config.label}
    </span>
  );
}
