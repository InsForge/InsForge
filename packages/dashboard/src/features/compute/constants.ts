import type { ServiceSchema, ServiceStatus } from '@insforge/shared-schemas';

export const statusColors: Record<ServiceStatus, string> = {
  running: 'bg-green-500',
  deploying: 'bg-yellow-500',
  creating: 'bg-yellow-500',
  stopped: 'bg-gray-400',
  failed: 'bg-red-500',
  destroying: 'bg-orange-500',
};

export const CPU_TIERS = [
  { value: 'shared-1x', label: 'Shared 1x' },
  { value: 'shared-2x', label: 'Shared 2x' },
  { value: 'performance-1x', label: 'Performance 1x' },
  { value: 'performance-2x', label: 'Performance 2x' },
  { value: 'performance-4x', label: 'Performance 4x' },
] as const;

export const MEMORY_OPTIONS = [256, 512, 1024, 2048, 4096, 8192] as const;

export const REGIONS = [
  { value: 'iad', label: 'Ashburn, VA (iad)' },
  { value: 'sin', label: 'Singapore (sin)' },
  { value: 'lax', label: 'Los Angeles (lax)' },
  { value: 'lhr', label: 'London (lhr)' },
  { value: 'nrt', label: 'Tokyo (nrt)' },
  { value: 'ams', label: 'Amsterdam (ams)' },
  { value: 'syd', label: 'Sydney (syd)' },
] as const;

/** Return the actual reachable .fly.dev URL instead of a custom domain that may not resolve */
export function getReachableUrl(service: ServiceSchema): string | null {
  if (service.flyAppId) {
    return `https://${service.flyAppId}.fly.dev`;
  }
  return service.endpointUrl;
}
