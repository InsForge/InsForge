import { useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { functionService } from '../services/function.service';
import { FunctionSchema } from '@insforge/shared-schemas';
import { useToast } from '@/lib/hooks/useToast';

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

    // Error
    error,

    // Actions
    selectFunction,
    clearSelection,
    deleteFunction: deleteFunctionMutation.mutate,
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
