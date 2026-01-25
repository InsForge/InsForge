import { useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { aiService } from '@/features/ai/services/ai.service';
import {
  CreateAIConfigurationRequest,
  UpdateAIConfigurationRequest,
  ModalitySchema,
  AIModelSchema,
  AIConfigurationWithUsageSchema,
} from '@insforge/shared-schemas';
import { useToast } from '@/lib/hooks/useToast';
import {
  filterModelsByModalities,
  sortModelsByConfigurationStatus,
  type ModelOption,
  toModelOption,
} from '../helpers';

interface UseAIConfigsOptions {
  enabled?: boolean;
}

export function useAIConfigs(options: UseAIConfigsOptions = {}) {
  const { enabled = true } = options;
  const queryClient = useQueryClient();
  const { showToast } = useToast();

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

  // Fetch AI configurations list
  const {
    data: configurations,
    isLoading: isLoadingConfigurations,
    error: configurationsError,
  } = useQuery<AIConfigurationWithUsageSchema[]>({
    queryKey: ['ai-configurations'],
    queryFn: () => aiService.listConfigurations(),
    enabled: enabled,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  // Create configuration mutation
  const createConfigurationMutation = useMutation({
    mutationFn: (data: CreateAIConfigurationRequest) => aiService.createConfiguration(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ai-configurations'] });
      showToast('Model added successfully', 'success');
    },
    onError: (error: Error) => {
      showToast(`Failed to add model: ${error.message}`, 'error');
    },
  });

  // Update configuration mutation
  const updateConfigurationMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateAIConfigurationRequest }) =>
      aiService.updateConfiguration(id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ai-configurations'] });
      showToast('Model updated successfully', 'success');
    },
    onError: (error: Error) => {
      showToast(`Failed to update model: ${error.message}`, 'error');
    },
  });

  // Delete configuration mutation
  const deleteConfigurationMutation = useMutation({
    mutationFn: (id: string) => aiService.deleteConfiguration(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ai-configurations'] });
      showToast('Model deleted successfully', 'success');
    },
    onError: (error: Error) => {
      showToast(`Failed to delete model: ${error.message}`, 'error');
    },
  });

  // Convert configurations to ModelOptions
  const configurationOptions = useMemo(
    () => (configurations || []).map(toModelOption),
    [configurations]
  );

  // Get configured model IDs for filtering
  const configuredModelIds = useMemo(
    () => configurations?.map((config) => config.modelId) || [],
    [configurations]
  );

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

      // Sort with configured models at the end
      return sortModelsByConfigurationStatus(modelOptions, configuredModelIds);
    },
    [allAvailableModels, configuredModelIds]
  );

  return {
    // Models data
    isLoadingModels,
    modelsError,

    // Configured providers
    allAvailableModels,

    // Configurations data
    isLoadingConfigurations,
    configurationsError,

    // Configuration mutations
    createConfiguration: createConfigurationMutation.mutate,
    updateConfiguration: updateConfigurationMutation.mutate,
    deleteConfiguration: deleteConfigurationMutation.mutate,

    // Helper functions
    getFilteredModels,

    // Return converted configurations instead of raw data
    configurationOptions,
    configuredModelIds,
  };
}
