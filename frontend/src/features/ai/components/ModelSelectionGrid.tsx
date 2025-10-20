import { AIModelCard } from './AIConfigCard';
import { ModelOption } from '../helpers';

interface ModelSelectionGridProps {
  models: ModelOption[];
  selectedModelId: string;
  onSelectModel: (modelId: string) => void;
  configuredModelIds: string[];
}

export function ModelSelectionGrid({
  models,
  selectedModelId,
  onSelectModel,
  configuredModelIds,
}: ModelSelectionGridProps) {
  if (!models.length) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[300px] mr-6">
        <div className="text-center">
          <p className="text-neutral-500 dark:text-neutral-400 text-base">
            No models match the selected filters.
          </p>
          <p className="text-neutral-400 dark:text-neutral-500 text-sm mt-2">
            Try adjusting your input/output modality filters.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 grid grid-cols-3 gap-5 auto-rows-fr mr-6">
      {models.map((model) => {
        const isConfigured = configuredModelIds.includes(model.modelId);
        const isSelected = selectedModelId === model.modelId;

        return (
          <AIModelCard
            key={model.id}
            config={model}
            mode="selectable"
            isSelected={isSelected}
            isDisabled={isConfigured}
            onSelect={() => !isConfigured && onSelectModel(model.modelId)}
          />
        );
      })}
    </div>
  );
}
