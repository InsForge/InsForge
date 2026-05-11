import { useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { aiService } from '#features/ai/services/ai.service';
import { ModalitySchema, AIModelSchema } from '@insforge/shared-schemas';
import { filterModelsByModalities, type ModelOption, toModelOption } from '#features/ai/helpers';

interface UseAIConfigsOptions {
  enabled?: boolean;
}

export function useAIConfigs(options: UseAIConfigsOptions = {}) {
  const { enabled = true } = options;

  // Fetch AI models configuration
  const {
    data: modelsData,
    isLoading: isLoadingModels,
    error: modelsError,
  } = useQuery<AIModelSchema[]>({
    queryKey: ['ai-models'],
    queryFn: () => aiService.getModels(),
    enabled: enabled,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  // All available models from all providers
  const allAvailableModels = useMemo(() => modelsData || [], [modelsData]);

  // Helper function to get filtered and processed models
  const getFilteredModels = useCallback(
    (inputModality: ModalitySchema[], outputModality: ModalitySchema[]): ModelOption[] => {
      // If both modality arrays are empty, return all models
      const shouldFilter = inputModality.length || outputModality.length;

      const filteredRawModels = shouldFilter
        ? filterModelsByModalities(allAvailableModels, inputModality, outputModality)
        : allAvailableModels;

      // Convert to ModelOption using centralized converter
      const modelOptions = filteredRawModels.map(toModelOption);

      return modelOptions;
    },
    [allAvailableModels]
  );

  return {
    // Models data
    isLoadingModels,
    modelsError,

    // Configured providers
    allAvailableModels,

    // Helper functions
    getFilteredModels,
  };
}
