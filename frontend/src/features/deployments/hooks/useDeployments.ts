import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { deploymentsService, type DeploymentSchema } from '../services/deployments.service';
import { useToast } from '@/lib/hooks/useToast';
import type { StartDeploymentRequest } from '@insforge/shared-schemas';

export function useDeployments() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [selectedDeployment, setSelectedDeployment] = useState<DeploymentSchema | null>(null);

  // ============================================================================
  // Pagination State
  // ============================================================================

  const [paginationParams, setPaginationParams] = useState({
    limit: 50,
    offset: 0,
  });

  // ============================================================================
  // Deployments Query
  // ============================================================================

  const {
    data: deployments = [],
    isLoading: isLoadingDeployments,
    error: deploymentsError,
    refetch: refetchDeployments,
  } = useQuery({
    queryKey: ['deployments', paginationParams],
    queryFn: () =>
      deploymentsService.listDeployments(paginationParams.limit, paginationParams.offset),
    staleTime: 30 * 1000, // 30 seconds - deployments status can change
  });

  // ============================================================================
  // Mutations
  // ============================================================================

  const createDeploymentMutation = useMutation({
    mutationFn: () => deploymentsService.createDeployment(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['deployments'] });
      showToast('Deployment created successfully', 'success');
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to create deployment', 'error');
    },
  });

  const startDeploymentMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data?: StartDeploymentRequest }) =>
      deploymentsService.startDeployment(id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['deployments'] });
      showToast('Deployment started successfully', 'success');
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to start deployment', 'error');
    },
  });

  const syncDeploymentMutation = useMutation({
    mutationFn: (id: string) => deploymentsService.syncDeployment(id),
    onSuccess: (updatedDeployment) => {
      void queryClient.invalidateQueries({ queryKey: ['deployments'] });
      // Update selected deployment if it's the one being synced
      if (selectedDeployment?.id === updatedDeployment.id) {
        setSelectedDeployment(updatedDeployment);
      }
      showToast('Deployment synced successfully', 'success');
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to sync deployment', 'error');
    },
  });

  const cancelDeploymentMutation = useMutation({
    mutationFn: (id: string) => deploymentsService.cancelDeployment(id),
    onSuccess: (_, id) => {
      void queryClient.invalidateQueries({ queryKey: ['deployments'] });
      showToast('Deployment cancelled successfully', 'success');
      if (selectedDeployment?.id === id) {
        setSelectedDeployment(null);
      }
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to cancel deployment', 'error');
    },
  });

  // ============================================================================
  // Actions
  // ============================================================================

  const selectDeployment = useCallback((deployment: DeploymentSchema | null) => {
    setSelectedDeployment(deployment);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedDeployment(null);
  }, []);

  const setPage = useCallback((page: number) => {
    setPaginationParams((prev) => ({
      ...prev,
      offset: (page - 1) * prev.limit,
    }));
  }, []);

  // ============================================================================
  // Computed Values
  // ============================================================================

  const deploymentsCount = deployments.length;
  const pageSize = paginationParams.limit;
  const currentPage = Math.floor(paginationParams.offset / pageSize) + 1;
  // Note: Total count would ideally come from API, for now we estimate
  const hasMorePages = deployments.length === pageSize;

  return {
    // Deployments
    deployments,
    deploymentsCount,
    selectedDeployment,
    isLoadingDeployments,
    deploymentsError,

    // Pagination
    pageSize,
    currentPage,
    hasMorePages,
    setPage,

    // Loading states
    isLoading: isLoadingDeployments,

    // Mutations states
    isCreating: createDeploymentMutation.isPending,
    isStarting: startDeploymentMutation.isPending,
    isSyncing: syncDeploymentMutation.isPending,
    isCancelling: cancelDeploymentMutation.isPending,

    // Actions
    selectDeployment,
    clearSelection,
    createDeployment: createDeploymentMutation.mutateAsync,
    startDeployment: startDeploymentMutation.mutate,
    syncDeployment: syncDeploymentMutation.mutate,
    cancelDeployment: cancelDeploymentMutation.mutate,
    refetchDeployments,
  };
}
