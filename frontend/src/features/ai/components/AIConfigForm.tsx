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
} from '@insforge/shared-schemas';
import {
  getProviderLogo,
  calculatePriceLevel,
  getProviderDisplayName,
} from '../helpers';
import { ModalityField } from './fields/ModalityField';
import { ModelSelectionField } from './fields/ModelSelectionField';
import { SystemPromptField } from './fields/SystemPromptField';

interface AIConfigFormProps {
  mode: 'create' | 'edit';
  editingConfig?: AIConfigurationWithUsageSchema;
  onSubmit: (data: CreateAIConfigurationRequest | UpdateAIConfigurationRequest) => void;
}

interface ModelOption {
  value: string;
  label: string;
  company: string;
  priceLevel: 'FREE' | '$' | '$$' | '$$$';
  priceColor: string;
  logo: React.FunctionComponent<React.SVGProps<SVGSVGElement>>;
}

export function AIConfigForm({ mode, editingConfig, onSubmit }: AIConfigFormProps) {
  const { configuredTextProviders, configuredImageProviders, configurations } = useAIConfigs();
  const [selectedInputModality, setSelectedInputModality] = useState<string>('text');
  const [selectedOutputModality, setSelectedOutputModality] = useState<string>('text');


  // Filter models based on input and output modalities
  const filteredModels = useMemo(() => {
    const allModels: ModelOption[] = [];

    // Collect all models from configured providers
    [...configuredTextProviders, ...configuredImageProviders].forEach((provider) => {
      provider.models.forEach((model) => {
        // Check if model supports the selected input and output modalities
        const supportsInput =
          model.architecture?.input_modalities?.includes(selectedInputModality) ?? false;
        const supportsOutput =
          model.architecture?.output_modalities?.includes(selectedOutputModality) ?? false;

        if (supportsInput && supportsOutput) {
          const companyId = model.id.split('/')[0];
          const company = getProviderDisplayName(companyId);
          const priceInfo = calculatePriceLevel(model.pricing);
          const logoComponent = getProviderLogo(companyId);

          allModels.push({
            value: model.id,
            label: model.name,
            company,
            priceLevel: priceInfo.level,
            priceColor: priceInfo.color,
            logo: logoComponent,
          });
        }
      });
    });

    // Sort models by name
    allModels.sort((a, b) => a.label.localeCompare(b.label));

    return allModels;
  }, [
    configuredTextProviders,
    configuredImageProviders,
    selectedInputModality,
    selectedOutputModality,
  ]);

  const getInitialCreateValues = useCallback((): CreateAIConfigurationRequest => {
    if (editingConfig && mode === 'create') {
      return {
        modality: editingConfig.modality,
        provider: 'openrouter', // Always OpenRouter now
        modelId: editingConfig.modelId,
        systemPrompt: editingConfig.systemPrompt,
      };
    }

    return {
      modality: 'text', // Default to text modality
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
      setSelectedInputModality('text');
      setSelectedOutputModality('text');
      createForm.reset(initialValues);
    } else {
      const initialValues = getInitialEditValues();
      setSelectedInputModality('text');
      setSelectedOutputModality('text');
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
      onSubmit(data);
    },
    [onSubmit]
  );

  // Check if a model is already configured
  const isModelConfigured = useCallback(
    (modelId: string) => {
      if (!configurations) {
        return false;
      }

      // When editing, exclude the current config from the check
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
        {filteredModels.length === 0 ? (
          <div className="text-sm text-zinc-500 dark:text-zinc-400 text-center py-8">
            No AI models available. Please configure your OpenRouter API key to access AI models.
          </div>
        ) : (
          <div className="flex flex-col gap-6 w-full items-stretch">
            {/* Input/Output fields - only show in create mode */}
            {isCreateMode && (
              <>
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
              </>
            )}

            {/* Model selection field */}
            {isCreateMode ? (
              <ModelSelectionField
                models={filteredModels}
                selectedModelId={createForm.watch('modelId')}
                onModelChange={(modelId) => {
                  createForm.setValue('modelId', modelId);
                  createForm.setValue('provider', 'openrouter');
                }}
                isModelConfigured={isModelConfigured}
              />
            ) : (
              <ModelSelectionField
                models={[]}
                isReadOnly={true}
                readOnlyModelId={editingConfig?.modelId}
              />
            )}

            {/* System prompt field */}
            <SystemPromptField
              register={isCreateMode ? createForm.register : editForm.register}
              error={form.formState.errors.systemPrompt}
            />
          </div>
        )}
      </div>
    </form>
  );
}
