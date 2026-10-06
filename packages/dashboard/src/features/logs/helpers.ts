/**
 * Severity configuration for badges
 */
export const SEVERITY_CONFIG = {
  error: { color: '#EF4444', label: 'Error' },
  warning: { color: '#FCD34D', label: 'Warning' },
  informational: { color: '#A3A3A3', label: 'Info' },
} as const;

export type SeverityType = keyof typeof SEVERITY_CONFIG;

/**
 * Default page size for logs pagination
 */
export const LOGS_PAGE_SIZE = 50;
