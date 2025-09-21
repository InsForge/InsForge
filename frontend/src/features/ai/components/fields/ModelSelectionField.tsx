import { Label } from '@/components/radix/Label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/radix/Select';

interface ModelOption {
  value: string;
  label: string;
  company: string;
  priceLevel: 'FREE' | '$' | '$$' | '$$$';
  priceColor: string;
  logo: undefined | React.FunctionComponent<React.SVGProps<SVGSVGElement>>;
}

interface ModelSelectionFieldProps {
  models: ModelOption[];
  selectedModelId?: string;
  onModelChange?: (modelId: string) => void;
  isReadOnly?: boolean;
  readOnlyModelId?: string;
  isModelConfigured?: (modelId: string) => boolean;
  disabled?: boolean;
}

export function ModelSelectionField({
  models,
  selectedModelId,
  onModelChange,
  isReadOnly = false,
  readOnlyModelId,
  isModelConfigured,
  disabled = false,
}: ModelSelectionFieldProps) {
  const hasModels = models.length > 0;

  if (isReadOnly) {
    return (
      <div className="flex flex-row gap-10 items-center">
        <Label className="w-34 text-sm font-normal text-zinc-950 dark:text-neutral-50">
          AI Model <span className="text-red-500">*</span>
        </Label>
        <div className="w-full flex items-center h-9 px-3 py-2 text-sm bg-zinc-50 dark:bg-neutral-900 border border-zinc-200 dark:border-neutral-700 rounded-md text-zinc-600 dark:text-zinc-400">
          {readOnlyModelId}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-row gap-10 items-center">
      <Label className="w-34 text-sm font-normal text-zinc-950 dark:text-neutral-50">
        AI Model <span className="text-red-500">*</span>
      </Label>
      <Select
        value={selectedModelId || ''}
        onValueChange={onModelChange || (() => {})}
        disabled={!hasModels || disabled}
      >
        <SelectTrigger
          id="model"
          className="w-full h-9 bg-transparent dark:bg-neutral-900 dark:border-neutral-700 dark:text-white"
        >
          <SelectValue asChild placeholder={hasModels ? 'Select model' : 'No models available'}>
            {selectedModelId &&
              (() => {
                const selectedModel = models.find((m) => m.value === selectedModelId);
                if (selectedModel) {
                  return (
                    <div className="flex items-center justify-between w-full mr-2">
                      <div className="flex items-center gap-2">
                        {selectedModel.logo ? (
                          <selectedModel.logo className="w-5 h-5" />
                        ) : (
                          <div className="w-5 h-5 bg-gray-500 rounded flex items-center justify-center text-white text-xs font-bold">
                            {selectedModel.company.slice(0, 1).toUpperCase()}
                          </div>
                        )}
                        <span className="truncate">{selectedModel.label}</span>
                      </div>
                      <div className={`text-xs font-medium ${selectedModel.priceColor}`}>
                        {selectedModel.priceLevel}
                      </div>
                    </div>
                  );
                }
                return <span>{selectedModelId}</span>;
              })()}
          </SelectValue>
        </SelectTrigger>
        <SelectContent className="dark:bg-neutral-900 dark:border-neutral-700">
          {hasModels ? (
            models.map((modelOption, index) => {
              const isConfigured = isModelConfigured?.(modelOption.value) ?? false;
              return (
                <SelectItem
                  key={`${modelOption.value}-${index}`}
                  value={modelOption.value}
                  disabled={isConfigured}
                  className={
                    isConfigured
                      ? 'dark:text-zinc-500 text-zinc-400 cursor-not-allowed'
                      : 'dark:text-white dark:hover:bg-neutral-700'
                  }
                >
                  <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-2">
                      {modelOption.logo ? (
                        <modelOption.logo className="w-5 h-5" />
                      ) : (
                        <div className="w-5 h-5 bg-gray-500 rounded flex items-center justify-center text-white text-xs font-bold">
                          {modelOption.company.slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <span className="truncate">{modelOption.label}</span>
                      {isConfigured && (
                        <span className="text-xs opacity-60">(Already configured)</span>
                      )}
                    </div>
                    <div className={`text-xs font-medium ${modelOption.priceColor}`}>
                      {modelOption.priceLevel}
                    </div>
                  </div>
                </SelectItem>
              );
            })
          ) : (
            <SelectItem value="no-models" disabled className="dark:text-zinc-400">
              No models available for selected input/output combination
            </SelectItem>
          )}
        </SelectContent>
      </Select>
    </div>
  );
}
