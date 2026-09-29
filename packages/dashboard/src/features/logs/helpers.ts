import type { LogSchema } from '@insforge/shared-schemas';

/**
 * Severity options for log filtering
 */
export const SEVERITY_OPTIONS = [
  { value: 'error', label: 'Error', color: 'text-red-500' },
  { value: 'warning', label: 'Warning', color: 'text-yellow-500' },
  { value: 'informational', label: 'Info', color: 'text-gray-500' },
] as const;

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

export interface FunctionLogFilters {
  functionSlug: string;
  requestId: string;
  status: string;
  from: string;
  to: string;
}

export function filterFunctionLogs(logs: LogSchema[], filters: FunctionLogFilters): LogSchema[] {
  const fromMs = filters.from ? Date.parse(filters.from) : Number.NEGATIVE_INFINITY;
  const toMs = filters.to ? Date.parse(filters.to) : Number.POSITIVE_INFINITY;
  const requestId = filters.requestId.trim().toLowerCase();

  return logs.filter((log) => {
    const body = log.body;
    if (filters.functionSlug && body.slug !== filters.functionSlug) {
      return false;
    }
    if (filters.status && String(body.status ?? '') !== filters.status) {
      return false;
    }
    if (requestId && String(body.requestId ?? '').toLowerCase() !== requestId) {
      return false;
    }

    if (filters.from || filters.to) {
      const timestampMs = Date.parse(log.timestamp);
      if (Number.isNaN(timestampMs)) {
        return false;
      }
      if (Number.isFinite(fromMs) && timestampMs < fromMs) {
        return false;
      }
      if (Number.isFinite(toMs) && timestampMs > toMs) {
        return false;
      }
    }
    return true;
  });
}
