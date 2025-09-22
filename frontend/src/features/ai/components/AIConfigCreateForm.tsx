import { useState, useEffect, useMemo, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useAIConfigs } from '../hooks/useAIConfigs';
import {
  createAIConfigurationRequestSchema,
  CreateAIConfigurationRequest,
  ModalitySchema,
} from '@insforge/shared-schemas';
import { useToast } from '@/lib/hooks/useToast';
import { ModalityField } from './fields/ModalityField';
import { ModelSelectionField } from './fields/ModelSelectionField';
import { SystemPromptField } from './fields/SystemPromptField';

interface AIConfigCreateFormProps {
  onSubmit: (data: CreateAIConfigurationRequest) => void;
}

export function AIConfigCreateForm({ onSubmit }: AIConfigCreateFormProps) {
  const { allConfiguredProviders, configurations, getFilteredModels } = useAIConfigs();
  const { showToast } = useToast();
  const [selectedInputModality, setSelectedInputModality] = useState<ModalitySchema[]>(['text']);
  const [selectedOutputModality, setSelectedOutputModality] = useState<ModalitySchema[]>(['text']);

  // Get filtered models based on selected modalities
  const filteredModels = useMemo(() => {
    return getFilteredModels(selectedInputModality, selectedOutputModality);
  }, [getFilteredModels, selectedInputModality, selectedOutputModality]);

  // Initialize form with default values
  const getInitialValues = useCallback((): CreateAIConfigurationRequest => {
    return {
      inputModality: ['text'],
      outputModality: ['text'],
      provider: 'openrouter',
      modelId: '',
      systemPrompt: undefined,
    };
  }, []);

  const form = useForm<CreateAIConfigurationRequest>({
    resolver: zodResolver(createAIConfigurationRequestSchema),
    defaultValues: getInitialValues(),
  });

  // Initialize form on mount
  useEffect(() => {
    const initialValues = getInitialValues();
    setSelectedInputModality(initialValues.inputModality);
    setSelectedOutputModality(initialValues.outputModality);
  }, [getInitialValues]);

  // Reset model selection when input/output modalities change
  useEffect(() => {
    form.setValue('modelId', '');
  }, [selectedInputModality, selectedOutputModality, form]);

  // Check if a model is already configured
  const isModelConfigured = useCallback(
    (modelId: string) => {
      if (!configurations) {
        return false;
      }

      return configurations.some((config) => config.modelId === modelId);
    },
    [configurations]
  );

  // Check if model selection should be disabled
  const isModelSelectionDisabled = useMemo(() => {
    return selectedInputModality.length === 0 || selectedOutputModality.length === 0;
  }, [selectedInputModality.length, selectedOutputModality.length]);

  const handleFormSubmit = useCallback(
    (data: CreateAIConfigurationRequest) => {
      // Validate that input and output modalities are selected
      if (selectedInputModality.length === 0) {
        showToast('Please select at least one input modality', 'error');
        return;
      }

      if (selectedOutputModality.length === 0) {
        showToast('Please select at least one output modality', 'error');
        return;
      }

      // Find the selected model to get its actual architecture
      const allModels = allConfiguredProviders.flatMap((provider) => provider.models);
      const selectedModel = allModels.find((model) => model.id === data.modelId);

      if (!selectedModel) {
        showToast('Selected model not found', 'error');
        return;
      }

      // Use the model's actual architecture capabilities
      const actualInputModality = (selectedModel.architecture?.input_modalities || [
        'text',
      ]) as ModalitySchema[];
      const actualOutputModality = (selectedModel.architecture?.output_modalities || [
        'text',
      ]) as ModalitySchema[];

      const createData: CreateAIConfigurationRequest = {
        ...data,
        inputModality: actualInputModality,
        outputModality: actualOutputModality,
      };

      onSubmit(createData);
    },
    [
      onSubmit,
      selectedInputModality.length,
      selectedOutputModality.length,
      allConfiguredProviders,
      showToast,
    ]
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
        <div className="flex flex-col gap-6 w-full items-stretch">
          {/* Input modality field */}
          <ModalityField
            fieldType="input"
            value={selectedInputModality}
            onChange={setSelectedInputModality}
          />

          {/* Output modality field */}
          <ModalityField
            fieldType="output"
            value={selectedOutputModality}
            onChange={setSelectedOutputModality}
          />

          {/* Model selection field */}
          <ModelSelectionField
            models={filteredModels}
            selectedModelId={form.watch('modelId')}
            onModelChange={(modelId) => {
              form.setValue('modelId', modelId);
              form.setValue('provider', 'openrouter');
            }}
            isModelConfigured={isModelConfigured}
            disabled={isModelSelectionDisabled}
          />

          {/* System prompt field */}
          <SystemPromptField<CreateAIConfigurationRequest>
            register={form.register}
            error={form.formState.errors.systemPrompt}
          />
        </div>
      </div>
    </form>
  );
}
