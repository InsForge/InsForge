import { useState, useEffect, useMemo } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components';
import { CreateAIConfigurationRequest, ModalitySchema } from '@insforge/shared-schemas';
import { useAIConfigs } from '../hooks/useAIConfigs';
import { useToast } from '@/lib/hooks/useToast';
import { ModalityFilterSidebar } from './ModalityFilterSidebar';
import { ModelSelectionGrid } from './ModelSelectionGrid';

interface ModelSelectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (data: CreateAIConfigurationRequest) => void;
}

export function ModelSelectionDialog({ open, onOpenChange, onSuccess }: ModelSelectionDialogProps) {
  const { allAvailableModels, configuredModelIds, getFilteredModels } = useAIConfigs();
  const { showToast } = useToast();

  const [selectedInputModalities, setSelectedInputModalities] = useState<ModalitySchema[]>([]);
  const [selectedOutputModalities, setSelectedOutputModalities] = useState<ModalitySchema[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string>(''); // This is the modelId of the selected model

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (!open) {
      setSelectedInputModalities([]);
      setSelectedOutputModalities([]);
      setSelectedModelId('');
    }
  }, [open]);

  // Use the existing filtered models logic from useAIConfigs
  const filteredModels = useMemo(() => {
    return getFilteredModels(selectedInputModalities, selectedOutputModalities);
  }, [getFilteredModels, selectedInputModalities, selectedOutputModalities]);

  // Reset model selection when modalities change
  useEffect(() => {
    if (selectedModelId) {
      const stillAvailable = filteredModels.some((model) => model.modelId === selectedModelId);
      if (!stillAvailable) {
        setSelectedModelId('');
      }
    }
  }, [selectedInputModalities, selectedOutputModalities, filteredModels, selectedModelId]);

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const selectedModel = allAvailableModels.find((model) => model.modelId === selectedModelId);

    if (!selectedModel) {
      showToast('Selected model not found', 'error');
      return;
    }

    const createData: CreateAIConfigurationRequest = {
      provider: selectedModel.provider,
      modelId: selectedModel.modelId,
      inputModality: selectedModel.inputModality,
      outputModality: selectedModel.outputModality,
    };

    onSuccess(createData);
    onOpenChange(false);
  };

  const handleCancel = () => {
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="max-w-5xl h-[80vh] p-0 gap-0 border-zinc-200 shadow-[0px_1px_3px_0px_rgba(0,0,0,0.1)] flex flex-col"
      >
        <DialogHeader className="pl-6 pr-4 py-3 flex flex-col gap-1 justify-start border-b border-zinc-200 dark:border-neutral-700 flex-shrink-0">
          <DialogTitle className="text-lg font-semibold text-zinc-950 dark:text-white">
            Select AI Model for Integration
          </DialogTitle>
        </DialogHeader>

        <form
          id="model-selection-form"
          onSubmit={handleFormSubmit}
          className="flex flex-col flex-1 overflow-hidden"
        >
          <div className="flex gap-5 py-6 pl-6 flex-1 overflow-hidden">
            <ModalityFilterSidebar
              inputModalities={selectedInputModalities}
              outputModalities={selectedOutputModalities}
              onInputChange={setSelectedInputModalities}
              onOutputChange={setSelectedOutputModalities}
            />
            <div className="flex-1 overflow-y-auto">
              <ModelSelectionGrid
                models={filteredModels}
                selectedModelId={selectedModelId}
                onSelectModel={setSelectedModelId}
                configuredModelIds={configuredModelIds}
              />
            </div>
          </div>
        </form>

        <DialogFooter className="p-6 gap-3 border-t border-zinc-200 dark:border-neutral-700 flex-shrink-0">
          <Button
            type="button"
            variant="outline"
            onClick={handleCancel}
            className="h-9 px-3 py-2 rounded-sm text-sm font-medium dark:bg-neutral-600 dark:text-zinc-300 dark:border-neutral-600 dark:hover:bg-neutral-700"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="model-selection-form"
            disabled={!selectedModelId}
            className="h-9 px-3 py-2 rounded-sm text-sm font-medium bg-zinc-950 text-white hover:bg-zinc-800 disabled:opacity-40 dark:bg-emerald-300 dark:text-zinc-950 dark:hover:bg-emerald-400"
          >
            Add Integration
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
