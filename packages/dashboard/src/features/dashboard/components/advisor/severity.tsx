import CriticalIcon from '#assets/icons/severity_critical.svg?react';
import InfoIcon from '#assets/icons/severity_info.svg?react';
import WarningIcon from '#assets/icons/severity_warning.svg?react';

export const SEVERITY_ICON = {
  critical: CriticalIcon,
  warning: WarningIcon,
  info: InfoIcon,
} as const;

export const SEVERITY_TONE = {
  critical: 'text-destructive',
  warning: 'text-warning',
  info: 'text-info',
} as const;
