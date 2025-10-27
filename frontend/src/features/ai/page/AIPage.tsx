import { useState, useEffect } from 'react';
import { Plus, Loader2 } from 'lucide-react';
import { Button } from '@/components/radix/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useAIConfigs } from '../hooks/useAIConfigs';
import { useAIRemainingCredits } from '../hooks/useAIUsage';
import {
  CreateAIConfigurationRequest,
  UpdateAIConfigurationRequest,
} from '@insforge/shared-schemas';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { useToast } from '@/lib/hooks/useToast';
import { ModelSelectionDialog } from '@/features/ai/components/ModelSelectionDialog';
import { SystemPromptDialog } from '@/features/ai/components/SystemPromptDialog';
import { AIModelCard } from '@/features/ai/components/AIConfigCard';
import AIEmptyState from '@/features/ai/components/AIEmptyState';
import { isInsForgeCloudProject } from '@/lib/utils/utils';

export default function AIPage() {
  const {
    configurationOptions,
    isLoadingConfigurations,
    createConfiguration,
    updateConfiguration,
    deleteConfiguration,
  } = useAIConfigs();

  const { data: credits, error: getAICreditsError } =
    useAIRemainingCredits(!isInsForgeCloudProject());

  const { confirm, confirmDialogProps } = useConfirm();
  const { showToast } = useToast();

  // Handle AI credits error
  useEffect(() => {
    if (getAICreditsError) {
      console.error('Failed to fetch AI credits:', getAICreditsError);
      const errorMessage = getAICreditsError.message || 'Failed to load AI credits';
      showToast(errorMessage, 'error');
    }
  }, [getAICreditsError, showToast]);

  // Format credits display
  const formatCredits = (remaining: number) => {
    if (remaining >= 1000) {
      return `${(remaining / 1000).toFixed(1)}K`;
    }
    return remaining.toFixed(2);
  };

  const [modelSelectionOpen, setModelSelectionOpen] = useState(false);
  const [systemPromptOpen, setSystemPromptOpen] = useState(false);
  const [editingConfigId, setEditingConfigId] = useState<string | undefined>();

  const handleEdit = (id: string) => {
    setEditingConfigId(id);
    setSystemPromptOpen(true);
  };

  const handleDelete = async (id: string) => {
    const shouldDelete = await confirm({
      title: 'Delete AI Configuration',
      description:
        'Are you certain you wish to remove this AI Integration? This action is irreversible.',
      confirmText: 'Delete',
      destructive: true,
    });

    if (shouldDelete) {
      deleteConfiguration(id);
    }
  };

  const handleCreate = () => {
    setModelSelectionOpen(true);
  };

  const handleModelSelectionSuccess = (configData: CreateAIConfigurationRequest) => {
    createConfiguration({
      inputModality: configData.inputModality,
      outputModality: configData.outputModality,
      provider: configData.provider,
      modelId: configData.modelId,
    });
  };

  // Derive the editing config from the ID
  const editingConfig = configurationOptions.find((c) => c.id === editingConfigId);

  const handleSystemPromptSuccess = (configData: UpdateAIConfigurationRequest) => {
    if (editingConfigId) {
      updateConfiguration({
        id: editingConfigId,
        data: {
          systemPrompt: configData.systemPrompt || null,
        },
      });
    }
  };

  return (
    <div className="flex h-full bg-white dark:bg-neutral-800 pt-8 pb-6">
      <div className="max-w-[1080px] mx-auto flex-1 flex flex-col gap-6 overflow-hidden">
        {/* Header Section */}
        <div className="w-full flex items-start justify-between">
          <div className="flex flex-col items-start gap-2">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold text-black dark:text-white">AI Integration</h1>
              {credits?.remaining && (
                <span className="text-sm font-normal text-neutral-700 dark:text-emerald-300 mt-[2.5px]">
                  {formatCredits(credits.remaining)} credit{credits.remaining !== 1 ? 's' : ''} left
                </span>
              )}
            </div>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              Your models are ready — build LLM-powered features or add more integrations.
            </p>
          </div>
          <Button
            className="h-9 py-2 pl-2 pr-3 text-sm font-medium gap-2 dark:text-white dark:bg-neutral-700 dark:hover:bg-neutral-600"
            onClick={handleCreate}
          >
            <Plus className="w-5 h-5" />
            New Integration
          </Button>
        </div>

        {/* Content Section */}
        <div className="flex-1 overflow-auto">
          {isLoadingConfigurations ? (
            <div className="flex-1 flex items-center justify-center h-full">
              <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
            </div>
          ) : configurationOptions.length ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {configurationOptions.map((modelOption) => (
                <AIModelCard
                  key={modelOption.id}
                  config={modelOption}
                  mode="configured"
                  onEdit={handleEdit}
                  onDelete={() => void handleDelete(modelOption.id)}
                />
              ))}
            </div>
          ) : (
            <AIEmptyState />
          )}
        </div>
      </div>

      {/* Model Selection Dialog */}
      <ModelSelectionDialog
        open={modelSelectionOpen}
        onOpenChange={setModelSelectionOpen}
        onSuccess={handleModelSelectionSuccess}
      />

      {/* System Prompt Dialog */}
      <SystemPromptDialog
        open={systemPromptOpen}
        onOpenChange={setSystemPromptOpen}
        initialSystemPrompt={editingConfig?.systemPrompt}
        onSuccess={handleSystemPromptSuccess}
      />

      {/* Confirm Dialog */}
      <ConfirmDialog {...confirmDialogProps} />
    </div>
  );
}
