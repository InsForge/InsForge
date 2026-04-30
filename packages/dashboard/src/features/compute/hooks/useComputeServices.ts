import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { computeServicesApi } from '../services/compute.service';
import type { CreateServiceRequest, UpdateServiceRequest } from '@insforge/shared-schemas';
import { useToast } from '../../../lib/hooks/useToast';
import { deriveHealth, type ServiceHealth } from '../lib/health';

export function useComputeServices() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const {
    data: services = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['compute', 'services'],
    queryFn: () => computeServicesApi.list(),
    staleTime: 30_000,
  });

  const createMutation = useMutation({
    mutationFn: (data: CreateServiceRequest) => computeServicesApi.create(data),
    onSuccess: (svc) => {
      void queryClient.invalidateQueries({ queryKey: ['compute', 'services'] });
      showToast(`Service "${svc.name}" created`, 'success');
    },
    onError: (err: Error) => {
      showToast(err.message || 'Failed to create service', 'error');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateServiceRequest }) =>
      computeServicesApi.update(id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['compute', 'services'] });
      showToast('Service updated', 'success');
    },
    onError: (err: Error) => {
      showToast(err.message || 'Failed to update service', 'error');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => computeServicesApi.remove(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['compute', 'services'] });
      showToast('Service deleted', 'success');
    },
    onError: (err: Error) => {
      showToast(err.message || 'Failed to delete service', 'error');
    },
  });

  const stopMutation = useMutation({
    mutationFn: (id: string) => computeServicesApi.stop(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['compute', 'services'] });
      showToast('Service stopped', 'success');
    },
    onError: (err: Error) => {
      showToast(err.message || 'Failed to stop service', 'error');
    },
  });

  const startMutation = useMutation({
    mutationFn: (id: string) => computeServicesApi.start(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['compute', 'services'] });
      showToast('Service started', 'success');
    },
    onError: (err: Error) => {
      showToast(err.message || 'Failed to start service', 'error');
    },
  });

  return {
    // Data
    services,

    // Loading states
    isLoading,
    isCreating: createMutation.isPending,
    isDeleting: deleteMutation.isPending,
    isStopping: stopMutation.isPending,
    isStarting: startMutation.isPending,

    // Errors
    error,

    // Actions
    create: createMutation.mutateAsync,
    update: updateMutation.mutateAsync,
    remove: deleteMutation.mutateAsync,
    stop: stopMutation.mutateAsync,
    start: startMutation.mutateAsync,
  };
}

export function useServiceLogs(serviceId: string | null) {
  return useQuery({
    queryKey: ['compute', 'services', serviceId, 'logs'],
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- guarded by enabled
    queryFn: () => computeServicesApi.logs(serviceId!, 50),
    enabled: !!serviceId,
    staleTime: 0,
  });
}

// Per-service crash-loop indicator for the grid view. Polls the events
// endpoint at 30s cadence — same data the detail-view ServiceLogs panel uses,
// so we don't introduce a new backend surface, and React Query dedupes the
// underlying fetch when the user expands a card.
//
// `enabled` should be false for stopped/failed/destroying/destroyed services:
// those don't crash-loop, and we don't want to ping Fly for them on every
// dashboard render. Caller is expected to gate on service.status.
export function useServiceHealth(
  serviceId: string,
  enabled: boolean
): { health: ServiceHealth | null; isLoading: boolean } {
  const query = useQuery({
    queryKey: ['compute', 'services', serviceId, 'logs'],
    queryFn: () => computeServicesApi.logs(serviceId, 50),
    enabled,
    staleTime: 30_000,
    refetchInterval: enabled ? 30_000 : false,
  });
  const health = query.data ? deriveHealth(query.data) : null;
  return { health, isLoading: query.isLoading };
}
