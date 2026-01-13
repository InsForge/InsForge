import { Switch } from '@/components';
import { ModelOption, formatPrice, formatModality } from '../helpers';

interface ModelRowProps {
  model: ModelOption;
  isEnabled: boolean;
  requests: number;
  onToggle: (modelId: string, isEnabled: boolean) => void;
}

export function ModelRow({ model, isEnabled, requests, onToggle }: ModelRowProps) {
  return (
    <div className="grid grid-cols-[200px_173px_173px_173px_173px_80px] gap-3 px-6 py-4 items-center rounded-lg bg-neutral-100 dark:bg-[#323232] mb-3">
      {/* Model with Toggle */}
      <div className="flex items-center gap-3">
        <Switch
          checked={isEnabled}
          onCheckedChange={() => onToggle(model.modelId, isEnabled)}
        />
        <span className="text-base font-medium text-black dark:text-white truncate">
          {model.modelName}
        </span>
      </div>

      {/* Input Modalities */}
      <div className="text-sm leading-6 text-black dark:text-white">
        {model.inputModality.map(formatModality).join(' / ')}
      </div>

      {/* Input Price */}
      <div className="text-sm text-black dark:text-white">
        {formatPrice(model.inputPrice)}
        {model.inputPrice && (
          <span className="text-neutral-400 dark:text-neutral-500"> / M tokens</span>
        )}
      </div>

      {/* Output Modalities */}
      <div className="text-sm leading-6 text-black dark:text-white">
        {model.outputModality.map(formatModality).join(' / ')}
      </div>

      {/* Output Price */}
      <div className="text-sm text-black dark:text-white">
        {formatPrice(model.outputPrice)}
        {model.outputPrice && (
          <span className="text-neutral-400 dark:text-neutral-500"> / M tokens</span>
        )}
      </div>

      {/* Requests Count */}
      <div className="text-right text-sm leading-6 text-black dark:text-white">
        {requests > 0 ? requests.toLocaleString() : '-'}
      </div>
    </div>
  );
}
