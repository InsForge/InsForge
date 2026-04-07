import type { ServiceStatus } from '@insforge/shared-schemas';

export const statusColors: Record<ServiceStatus, string> = {
  running: 'bg-green-500',
  deploying: 'bg-yellow-500',
  creating: 'bg-yellow-500',
  stopped: 'bg-gray-400',
  failed: 'bg-red-500',
  destroying: 'bg-orange-500',
};
