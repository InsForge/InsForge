import { useTranslation } from 'react-i18next';
import { SEVERITY_CONFIG, type SeverityType } from '#features/logs/helpers';
import { cn } from '@insforge/ui';

interface SeverityBadgeProps {
  severity: SeverityType;
}

const SEVERITY_LABEL_KEYS: Record<SeverityType, string> = {
  error: 'severityError',
  warning: 'severityWarning',
  informational: 'severityInfo',
};

export function SeverityBadge({ severity }: SeverityBadgeProps) {
  const { t } = useTranslation('chrome');
  const config = SEVERITY_CONFIG[severity] || SEVERITY_CONFIG.informational;
  const labelKey = SEVERITY_LABEL_KEYS[severity] ?? SEVERITY_LABEL_KEYS.informational;
  const label = t(`logs.${labelKey}`, { defaultValue: config.label });
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
      title={label}
    >
      {label}
    </span>
  );
}
