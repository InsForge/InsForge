import { useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { functionService } from '#features/functions/services/function.service';
import { FunctionSchema, type UpdateFunctionRequest } from '@insforge/shared-schemas';
import { useToast } from '#lib/hooks/useToast';

function getDeploymentFailureMessage(buildLogs?: string[]): string {
  const logs = buildLogs?.map((log) => log.trim()).filter(Boolean) ?? [];
  const lastLog = logs.length > 0 ? logs[logs.length - 1] : null;

  const explicitError = logs.find((log) => log.toLowerCase().includes('[error]')) ?? lastLog;

  if (!explicitError) {
    return 'Function saved, but deployment failed.';
  }

  const normalizedError = explicitError.replace(/^\[error\]\s*/i, '');
  return `Function saved, but deployment failed: ${normalizedError}`;
}

export function useFunctions() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [selectedFunction, setSelectedFunction] = useState<FunctionSchema | null>(null);

  // Query to fetch all functions
  const {
    data: functionsData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['functions'],
    queryFn: () => functionService.listFunctions(),
    staleTime: 2 * 60 * 1000, // Cache for 2 minutes
  });

  // Extract functions, runtime status, and deployment URL from response
  const functions = useMemo(() => functionsData?.functions || [], [functionsData]);
  const runtimeStatus = useMemo(() => functionsData?.runtime?.status || 'running', [functionsData]);
  const deploymentUrl = useMemo(() => functionsData?.deploymentUrl || null, [functionsData]);

  // Function to fetch and set selected function details
  const selectFunction = useCallback(
    async (func: FunctionSchema) => {
      try {
        const data = await functionService.getFunctionBySlug(func.slug);
        setSelectedFunction(data);
      } catch (error) {
        console.error('Failed to fetch function details:', error);
        const errorMessage =
          error instanceof Error ? error.message : 'Failed to load function details';
        showToast(errorMessage, 'error');
      }
    },
    [showToast]
  );

  // Function to clear selected function (back to list)
  const clearSelection = useCallback(() => {
    setSelectedFunction(null);
  }, []);

  // Delete function mutation (for future use)
  const deleteFunctionMutation = useMutation({
    mutationFn: (slug: string) => functionService.deleteFunction(slug),
    onSuccess: (_, slug) => {
      void queryClient.invalidateQueries({ queryKey: ['functions'] });
      showToast('Function deleted successfully', 'success');
      // Clear selection if deleted function was selected
      if (selectedFunction && selectedFunction.slug === slug) {
        setSelectedFunction(null);
      }
    },
    onError: (error: Error) => {
      const errorMessage = error instanceof Error ? error.message : 'Failed to delete function';
      showToast(errorMessage, 'error');
    },
  });

  const updateFunctionMutation = useMutation({
    mutationFn: ({ slug, updates }: { slug: string; updates: UpdateFunctionRequest }) =>
      functionService.updateFunction(slug, updates),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['functions'] });
      setSelectedFunction((previous) =>
        previous?.id === result.function.id ? result.function : previous
      );

      if (result.success && result.deployment?.status !== 'failed') {
        showToast('Function updated successfully', 'success');
        return;
      }

      showToast(getDeploymentFailureMessage(result.deployment?.buildLogs), 'warn', undefined, 6000);
    },
    onError: (error: Error) => {
      const errorMessage = error instanceof Error ? error.message : 'Failed to update function';
      showToast(errorMessage, 'error');
    },
  });

  // Helper to check if a function is selected
  const isViewingDetail = selectedFunction !== null;

  // Only show functions if runtime is available
  const displayFunctions = useMemo(
    () => (runtimeStatus === 'running' ? functions : []),
    [functions, runtimeStatus]
  );

  return {
    // Data
    functions: displayFunctions,
    functionsCount: displayFunctions.length,
    selectedFunction,
    isViewingDetail,
    deploymentUrl,

    // Runtime status
    runtimeStatus,
    isRuntimeAvailable: runtimeStatus === 'running',

    // Loading states
    isLoading,
    isDeleting: deleteFunctionMutation.isPending,
    isUpdating: updateFunctionMutation.isPending,

    // Error
    error,

    // Actions
    selectFunction,
    clearSelection,
    deleteFunction: useCallback(
      (slug: string) => deleteFunctionMutation.mutateAsync(slug),
      [deleteFunctionMutation]
    ),
    updateFunction: useCallback(
      (slug: string, updates: UpdateFunctionRequest) =>
        updateFunctionMutation.mutateAsync({ slug, updates }),
      [updateFunctionMutation]
    ),
    refetch,

    // Helpers
    getFunctionBySlug: useCallback(
      (slug: string): FunctionSchema | undefined => {
        return displayFunctions.find((func) => func.slug === slug);
      },
      [displayFunctions]
    ),
  };
}
