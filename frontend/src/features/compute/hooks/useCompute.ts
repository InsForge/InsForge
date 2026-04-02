import { useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { computeService } from '../services/compute.service';
import type {
  ContainerSchema,
  CreateContainerRequest,
  UpdateContainerRequest,
} from '@insforge/shared-schemas';
import { useToast } from '@/lib/hooks/useToast';

export function useCompute() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [selectedContainer, setSelectedContainer] = useState<ContainerSchema | null>(null);

  const {
    data: containersData,
    isLoading: isLoadingContainers,
    error: containersError,
  } = useQuery({
    queryKey: ['compute', 'containers'],
    queryFn: () => computeService.listContainers(),
    staleTime: 30 * 1000,
  });

  const containers = useMemo(() => containersData ?? [], [containersData]);

  const selectedContainerId = selectedContainer?.id;
  const {
    data: deploymentsData,
    isLoading: isLoadingDeployments,
    error: deploymentsError,
  } = useQuery({
    queryKey: ['compute', 'deployments', selectedContainerId],
    queryFn: () => {
      if (!selectedContainerId) {
        return Promise.resolve([]);
      }
      return computeService.listDeployments(selectedContainerId);
    },
    enabled: !!selectedContainerId,
    staleTime: 15 * 1000,
  });

  const deployments = useMemo(() => deploymentsData ?? [], [deploymentsData]);

  const { data: taskRunsData, isLoading: isLoadingTaskRuns } = useQuery({
    queryKey: ['compute', 'taskRuns', selectedContainer?.id],
    queryFn: () => computeService.listTaskRuns(selectedContainer!.id),
    enabled: !!selectedContainer && selectedContainer.runMode === 'task',
    staleTime: 15_000,
  });

  const taskRuns = useMemo(() => taskRunsData ?? [], [taskRunsData]);

  const selectContainer = useCallback((container: ContainerSchema | null) => {
    setSelectedContainer(container);
  }, []);

  const createContainerMutation = useMutation({
    mutationFn: (data: CreateContainerRequest) => computeService.createContainer(data),
    onSuccess: (container) => {
      void queryClient.invalidateQueries({ queryKey: ['compute', 'containers'] });
      showToast(`Container "${container.name}" created`, 'success');
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to create container', 'error');
    },
  });

  const updateContainerMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateContainerRequest }) =>
      computeService.updateContainer(id, data),
    onSuccess: (container) => {
      void queryClient.invalidateQueries({ queryKey: ['compute', 'containers'] });
      if (selectedContainer?.id === container.id) {
        setSelectedContainer(container);
      }
      showToast('Container updated', 'success');
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to update container', 'error');
    },
  });

  const deleteContainerMutation = useMutation({
    mutationFn: (id: string) => computeService.deleteContainer(id),
    onSuccess: (_, id) => {
      void queryClient.invalidateQueries({ queryKey: ['compute', 'containers'] });
      if (selectedContainer?.id === id) {
        setSelectedContainer(null);
      }
      showToast('Container deleted', 'success');
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to delete container', 'error');
    },
  });

  const deployMutation = useMutation({
    mutationFn: (containerId: string) => computeService.deploy(containerId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['compute'] });
      showToast('Deployment started', 'success');
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to start deployment', 'error');
    },
  });

  const rollbackMutation = useMutation({
    mutationFn: ({ containerId, deploymentId }: { containerId: string; deploymentId: string }) =>
      computeService.rollback(containerId, { deploymentId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['compute'] });
      showToast('Rollback started', 'success');
    },
    onError: (error: Error) => {
      showToast(error.message || 'Rollback failed', 'error');
    },
  });

  const runTaskMutation = useMutation({
    mutationFn: (containerId: string) => computeService.runTask(containerId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['compute', 'taskRuns'] });
      showToast('Task started', 'success');
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to start task', 'error');
    },
  });

  const stopTaskMutation = useMutation({
    mutationFn: ({ containerId, taskRunId }: { containerId: string; taskRunId: string }) =>
      computeService.stopTask(containerId, taskRunId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['compute', 'taskRuns'] });
      showToast('Task stopped', 'success');
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to stop task', 'error');
    },
  });

  return {
    containers,
    selectedContainer,
    deployments,
    taskRuns,

    isLoadingContainers,
    isLoadingDeployments,
    isLoadingTaskRuns,
    isCreating: createContainerMutation.isPending,
    isUpdating: updateContainerMutation.isPending,
    isDeleting: deleteContainerMutation.isPending,
    isDeploying: deployMutation.isPending,
    isRunningTask: runTaskMutation.isPending,

    containersError,
    deploymentsError,

    selectContainer,
    createContainer: useCallback(
      (data: CreateContainerRequest) => createContainerMutation.mutateAsync(data),
      [createContainerMutation]
    ),
    updateContainer: useCallback(
      (id: string, data: UpdateContainerRequest) =>
        updateContainerMutation.mutateAsync({ id, data }),
      [updateContainerMutation]
    ),
    deleteContainer: useCallback(
      (id: string) => deleteContainerMutation.mutateAsync(id),
      [deleteContainerMutation]
    ),
    deploy: useCallback(
      (containerId: string) => deployMutation.mutateAsync(containerId),
      [deployMutation]
    ),
    rollback: useCallback(
      (containerId: string, deploymentId: string) =>
        rollbackMutation.mutateAsync({ containerId, deploymentId }),
      [rollbackMutation]
    ),
    runTask: useCallback(
      (containerId: string) => runTaskMutation.mutate(containerId),
      [runTaskMutation]
    ),
    stopTask: useCallback(
      (containerId: string, taskRunId: string) =>
        stopTaskMutation.mutate({ containerId, taskRunId }),
      [stopTaskMutation]
    ),
  };
}
