import { useState, useEffect, useMemo, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useAIConfigs } from '../hooks/useAIConfigs';
import {
  AIConfigurationWithUsageSchema,
  createAIConfigurationRequestSchema,
  updateAIConfigurationRequestSchema,
  CreateAIConfigurationRequest,
  UpdateAIConfigurationRequest,
  ModalitySchema,
} from '@insforge/shared-schemas';
import {
  getProviderLogo,
  calculatePriceLevel,
  getProviderDisplayName,
  filterModelsByModalities,
} from '../helpers';
import { ModalityField } from './fields/ModalityField';
import { ModelSelectionField } from './fields/ModelSelectionField';
import { SystemPromptField } from './fields/SystemPromptField';

interface AIConfigFormProps {
  mode: 'create' | 'edit';
  editingConfig?: AIConfigurationWithUsageSchema;
  onSubmit: (data: CreateAIConfigurationRequest | UpdateAIConfigurationRequest) => void;
}

export function AIConfigForm({ mode, editingConfig, onSubmit }: AIConfigFormProps) {
  const { configuredTextProviders, configuredImageProviders, configurations } = useAIConfigs();
  const [selectedInputModality, setSelectedInputModality] = useState<ModalitySchema[]>(['text']);
  const [selectedOutputModality, setSelectedOutputModality] = useState<ModalitySchema[]>(['text']);

  const filteredModels = useMemo(() => {
    // Only calculate filtered models in create mode
    if (mode === 'edit') {
      return [];
    }

    const filteredRawModels = filterModelsByModalities(
      [...configuredTextProviders, ...configuredImageProviders],
      selectedInputModality,
      selectedOutputModality
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
  }, [
    mode,
    configuredTextProviders,
    configuredImageProviders,
    selectedInputModality,
    selectedOutputModality,
  ]);

  const getInitialCreateValues = useCallback((): CreateAIConfigurationRequest => {
    if (editingConfig && mode === 'create') {
      return {
        inputModality: editingConfig.inputModality,
        outputModality: editingConfig.outputModality,
        provider: 'openrouter', // Always OpenRouter now
        modelId: editingConfig.modelId,
        systemPrompt: editingConfig.systemPrompt,
      };
    }

    return {
      inputModality: ['text'], // Default to text modality
      outputModality: ['text'], // Default to text modality
      provider: 'openrouter', // Always OpenRouter now
      modelId: '',
      systemPrompt: undefined,
    };
  }, [mode, editingConfig]);

  const getInitialEditValues = useCallback((): UpdateAIConfigurationRequest => {
    return {
      systemPrompt: editingConfig?.systemPrompt ?? null,
    };
  }, [editingConfig]);

  const createForm = useForm<CreateAIConfigurationRequest>({
    resolver: zodResolver(createAIConfigurationRequestSchema),
    defaultValues: getInitialCreateValues(),
  });

  const editForm = useForm<UpdateAIConfigurationRequest>({
    resolver: zodResolver(updateAIConfigurationRequestSchema),
    defaultValues: getInitialEditValues(),
  });

  const form = mode === 'edit' ? editForm : createForm;
  const isCreateMode = mode === 'create';

  useEffect(() => {
    if (isCreateMode) {
      const initialValues = getInitialCreateValues();
      setSelectedInputModality(initialValues.inputModality);
      setSelectedOutputModality(initialValues.outputModality);
      createForm.reset(initialValues);
    } else {
      const initialValues = getInitialEditValues();
      setSelectedInputModality(['text']);
      setSelectedOutputModality(['text']);
      editForm.reset(initialValues);
    }
  }, [
    editingConfig,
    getInitialCreateValues,
    getInitialEditValues,
    createForm,
    editForm,
    isCreateMode,
  ]);

  // Reset model selection when input/output modalities change
  useEffect(() => {
    if (isCreateMode) {
      createForm.setValue('modelId', '');
    }
  }, [selectedInputModality, selectedOutputModality, isCreateMode, createForm]);

  const handleFormSubmit = useCallback(
    (data: CreateAIConfigurationRequest | UpdateAIConfigurationRequest) => {
      if (isCreateMode) {
        // For create mode, we need to get the actual model's architecture capabilities
        const selectedModelId = (data as CreateAIConfigurationRequest).modelId;

        // Find the selected model to get its actual architecture
        const allModels = [...configuredTextProviders, ...configuredImageProviders];
        const selectedModel = allModels
          .flatMap((provider) => provider.models)
          .find((model) => model.id === selectedModelId);

        if (!selectedModel) {
          console.error('Selected model not found');
          return;
        }

        const actualInputModality = (selectedModel.architecture?.input_modalities || [
          'text',
        ]) as ModalitySchema[];
        const actualOutputModality = (selectedModel.architecture?.output_modalities || [
          'text',
        ]) as ModalitySchema[];

        const createData: CreateAIConfigurationRequest = {
          ...(data as CreateAIConfigurationRequest),
          inputModality: actualInputModality,
          outputModality: actualOutputModality,
        };
        onSubmit(createData);
      } else {
        onSubmit(data as UpdateAIConfigurationRequest);
      }
    },
    [onSubmit, isCreateMode, configuredTextProviders, configuredImageProviders]
  );

  const isModelConfigured = useCallback(
    (modelId: string) => {
      if (!configurations) {
        return false;
      }

      return configurations.some(
        (config) => config.modelId === modelId && (!editingConfig || config.id !== editingConfig.id)
      );
    },
    [configurations, editingConfig]
  );

  return (
    <form
      id="ai-config-form"
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit(handleFormSubmit)();
      }}
      className="flex flex-col"
    >
      <div className="flex flex-col gap-6 p-6">
        {isCreateMode ? (
          <div className="flex flex-col gap-6 w-full items-stretch">
            {/* Input/Output fields */}
            <ModalityField
              fieldType="input"
              value={selectedInputModality}
              onChange={setSelectedInputModality}
            />
            <ModalityField
              fieldType="output"
              value={selectedOutputModality}
              onChange={setSelectedOutputModality}
            />

            {/* Model selection field */}
            <ModelSelectionField
              models={filteredModels}
              selectedModelId={createForm.watch('modelId')}
              onModelChange={(modelId) => {
                createForm.setValue('modelId', modelId);
                createForm.setValue('provider', 'openrouter');
              }}
              isModelConfigured={isModelConfigured}
            />

            {/* System prompt field */}
            <SystemPromptField
              register={createForm.register}
              error={form.formState.errors.systemPrompt}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-6 w-full items-stretch">
            <SystemPromptField
              register={editForm.register}
              error={form.formState.errors.systemPrompt}
            />
          </div>
        )}
      </div>
    </form>
  );
}
