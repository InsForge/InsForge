import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { computeServicesApi } from '../services/compute.service';
import type { CreateServiceRequest, UpdateServiceRequest } from '@insforge/shared-schemas';
import { useToast } from '../../../lib/hooks/useToast';

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
