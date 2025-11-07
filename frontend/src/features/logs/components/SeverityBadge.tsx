import { SEVERITY_CONFIG, type SeverityType } from '../helpers';

interface SeverityBadgeProps {
  severity: SeverityType;
}

export function SeverityBadge({ severity }: SeverityBadgeProps) {
  const config = SEVERITY_CONFIG[severity] || SEVERITY_CONFIG.informational;

  return (
    <div className="flex items-center gap-2 pr-1">
      <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: config.color }} />
      <span className="text-sm text-gray-900 dark:text-white font-normal leading-6">
        {config.label}
      </span>
    </div>
  );
}
