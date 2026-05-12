import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { aiService } from '#features/ai/services/ai.service';
import { ModalitySchema, AIModelSchema } from '@insforge/shared-schemas';
import { filterModelsByModalities, type ModelOption, toModelOption } from '#features/ai/helpers';

interface UseAIModelsOptions {
  enabled?: boolean;
}

export function useAIModels(options: UseAIModelsOptions = {}) {
  const { enabled = true } = options;

  const {
    data: modelsData,
    isLoading: isLoadingModels,
    error: modelsError,
  } = useQuery<AIModelSchema[]>({
    queryKey: ['ai-models'],
    queryFn: () => aiService.getModels(),
    enabled,
    staleTime: 5 * 60 * 1000,
  });

  const allAvailableModels = useMemo(() => modelsData || [], [modelsData]);

  const getFilteredModels = useCallback(
    (inputModality: ModalitySchema[], outputModality: ModalitySchema[]): ModelOption[] => {
      const shouldFilter = inputModality.length || outputModality.length;

      const filteredRawModels = shouldFilter
        ? filterModelsByModalities(allAvailableModels, inputModality, outputModality)
        : allAvailableModels;

      return filteredRawModels.map(toModelOption);
    },
    [allAvailableModels]
  );

  return {
    isLoadingModels,
    modelsError,
    allAvailableModels,
    getFilteredModels,
  };
}
