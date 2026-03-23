import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { computeService } from '../services/compute.service';
import { ContainerSchema, CreateContainerRequest, UpdateContainerRequest } from '@insforge/shared-schemas';
import { useToast } from '@/lib/hooks/useToast';

export function useCompute() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [selectedContainer, setSelectedContainer] = useState<ContainerSchema | null>(null);

  // Query: list all containers
  const {
    data: containersData,
    isLoading: isLoadingContainers,
    error: containersError,
    refetch: refetchContainers,
  } = useQuery({
    queryKey: ['compute', 'containers'],
    queryFn: () => computeService.listContainers(),
    staleTime: 30 * 1000, // 30 seconds
  });

  const containers = containersData?.containers ?? [];

  // Query: list deployments for selected container
  const {
    data: deploymentsData,
    isLoading: isLoadingDeployments,
    refetch: refetchDeployments,
  } = useQuery({
    queryKey: ['compute', 'deployments', selectedContainer?.id],
    queryFn: () => computeService.listDeployments(selectedContainer!.id),
    enabled: !!selectedContainer,
    staleTime: 15 * 1000,
  });

  const deployments = deploymentsData?.deployments ?? [];

  // Select / clear container
  const selectContainer = useCallback((container: ContainerSchema) => {
    setSelectedContainer(container);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedContainer(null);
  }, []);

  // Mutation: create container
  const createContainerMutation = useMutation({
    mutationFn: (data: CreateContainerRequest) => computeService.createContainer(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['compute', 'containers'] });
      showToast('Container created successfully', 'success');
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to create container', 'error');
    },
  });

  // Mutation: update container
  const updateContainerMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateContainerRequest }) =>
      computeService.updateContainer(id, data),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: ['compute', 'containers'] });
      // Keep selectedContainer in sync
      if (selectedContainer && selectedContainer.id === updated.id) {
        setSelectedContainer(updated);
      }
      showToast('Container updated successfully', 'success');
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to update container', 'error');
    },
  });

  // Mutation: delete container
  const deleteContainerMutation = useMutation({
    mutationFn: (id: string) => computeService.deleteContainer(id),
    onSuccess: (_, id) => {
      void queryClient.invalidateQueries({ queryKey: ['compute', 'containers'] });
      if (selectedContainer?.id === id) {
        setSelectedContainer(null);
      }
      showToast('Container deleted successfully', 'success');
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to delete container', 'error');
    },
  });

  // Mutation: deploy
  const deployMutation = useMutation({
    mutationFn: (containerId: string) => computeService.deploy(containerId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['compute', 'containers'] });
      void queryClient.invalidateQueries({ queryKey: ['compute', 'deployments'] });
      showToast('Deployment triggered successfully', 'success');
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to trigger deployment', 'error');
    },
  });

  // Mutation: rollback
  const rollbackMutation = useMutation({
    mutationFn: ({ containerId, deploymentId }: { containerId: string; deploymentId: string }) =>
      computeService.rollback(containerId, deploymentId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['compute', 'containers'] });
      void queryClient.invalidateQueries({ queryKey: ['compute', 'deployments'] });
      showToast('Rollback triggered successfully', 'success');
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to rollback', 'error');
    },
  });

  return {
    // Data
    containers,
    deployments,
    selectedContainer,

    // Loading states
    isLoadingContainers,
    isLoadingDeployments,
    isCreating: createContainerMutation.isPending,
    isUpdating: updateContainerMutation.isPending,
    isDeleting: deleteContainerMutation.isPending,
    isDeploying: deployMutation.isPending,
    isRollingBack: rollbackMutation.isPending,

    // Errors
    containersError,

    // Actions
    selectContainer,
    clearSelection,
    refetchContainers,
    refetchDeployments,

    // Mutations
    createContainer: createContainerMutation.mutate,
    updateContainer: updateContainerMutation.mutate,
    deleteContainer: deleteContainerMutation.mutate,
    deploy: deployMutation.mutate,
    rollback: rollbackMutation.mutate,
  };
}
