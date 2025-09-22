import { useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { aiService } from '@/features/ai/services/ai.service';
import {
  ListModelsResponse,
  AIConfigurationWithUsageSchema,
  CreateAIConfigurationRequest,
  UpdateAIConfigurationRequest,
  ModalitySchema,
} from '@insforge/shared-schemas';
import { useToast } from '@/lib/hooks/useToast';
import {
  getProviderLogo,
  calculatePriceLevel,
  getProviderDisplayName,
  filterModelsByModalities,
  type ModelOption,
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
    isLoading,
    error,
    refetch,
  } = useQuery<ListModelsResponse>({
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
    refetch: refetchConfigurations,
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
      showToast('AI configuration created successfully', 'success');
    },
    onError: (error: Error) => {
      showToast(`Failed to create configuration: ${error.message}`, 'error');
    },
  });

  // Update configuration mutation
  const updateConfigurationMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateAIConfigurationRequest }) =>
      aiService.updateConfiguration(id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ai-configurations'] });
      showToast('AI configuration updated successfully', 'success');
    },
    onError: (error: Error) => {
      showToast(`Failed to update configuration: ${error.message}`, 'error');
    },
  });

  // Delete configuration mutation
  const deleteConfigurationMutation = useMutation({
    mutationFn: (id: string) => aiService.deleteConfiguration(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ai-configurations'] });
      showToast('AI configuration deleted successfully', 'success');
    },
    onError: (error: Error) => {
      showToast(`Failed to delete configuration: ${error.message}`, 'error');
    },
  });

  // Extract configured providers (memoized to maintain referential stability)
  const configuredTextProviders = useMemo(
    () => modelsData?.text?.filter((p) => p.configured) || [],
    [modelsData?.text]
  );
  const configuredImageProviders = useMemo(
    () => modelsData?.image?.filter((p) => p.configured) || [],
    [modelsData?.image]
  );

  // Extract unconfigured providers
  const unconfiguredTextProviders = modelsData?.text?.filter((p) => !p.configured) || [];
  const unconfiguredImageProviders = modelsData?.image?.filter((p) => !p.configured) || [];

  // Get all available models (flat list)
  const allTextModels = modelsData?.text?.flatMap((p) => p.models) || [];
  const allImageModels = modelsData?.image?.flatMap((p) => p.models) || [];

  // Combined configured providers for easier consumption
  const allConfiguredProviders = useMemo(
    () => [...configuredTextProviders, ...configuredImageProviders],
    [configuredTextProviders, configuredImageProviders]
  );

  // Helper function to get filtered and processed models
  const getFilteredModels = useCallback(
    (inputModality: ModalitySchema[], outputModality: ModalitySchema[]): ModelOption[] => {
      const filteredRawModels = filterModelsByModalities(
        allConfiguredProviders,
        inputModality,
        outputModality
      );

      return filteredRawModels.map((model) => {
        const companyId = model.id.split('/')[0];
        const priceInfo = calculatePriceLevel(model.pricing);

        return {
          value: model.id,
          label: model.name,
          company: getProviderDisplayName(companyId),
          priceLevel: priceInfo.level,
          priceColor: priceInfo.color,
          logo: getProviderLogo(companyId),
        };
      });
    },
    [allConfiguredProviders]
  );

  // Check if any providers are configured
  const hasConfiguredTextProviders = configuredTextProviders.length > 0;
  const hasConfiguredImageProviders = configuredImageProviders.length > 0;
  const hasAnyConfiguration = hasConfiguredTextProviders || hasConfiguredImageProviders;

  return {
    // Raw data
    modelsData,
    isLoading,
    error,

    // Providers by type
    textProviders: modelsData?.text || [],
    imageProviders: modelsData?.image || [],

    // Configured providers
    configuredTextProviders,
    configuredImageProviders,
    allConfiguredProviders,

    // Unconfigured providers
    unconfiguredTextProviders,
    unconfiguredImageProviders,

    // Models lists
    allTextModels,
    allImageModels,

    // Status checks
    hasConfiguredTextProviders,
    hasConfiguredImageProviders,
    hasAnyConfiguration,

    // Configurations data
    configurations: configurations || [],
    isLoadingConfigurations,
    configurationsError,

    // Configuration mutations
    createConfiguration: createConfigurationMutation.mutate,
    updateConfiguration: updateConfigurationMutation.mutate,
    deleteConfiguration: deleteConfigurationMutation.mutate,

    // Mutation states
    isCreating: createConfigurationMutation.isPending,
    isUpdating: updateConfigurationMutation.isPending,
    isDeleting: deleteConfigurationMutation.isPending,

    // Operations
    refetch,
    refetchConfigurations,

    // Helper functions
    getFilteredModels,
  };
}
