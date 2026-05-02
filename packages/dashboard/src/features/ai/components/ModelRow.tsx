import { Switch } from '@insforge/ui';
import { ModelOption, formatPrice, formatModality } from '#features/ai/helpers';

interface ModelRowProps {
  model: ModelOption;
  isEnabled: boolean;
  requests: number;
  onToggle: (modelId: string, isEnabled: boolean) => void;
}

export function ModelRow({ model, isEnabled, requests, onToggle }: ModelRowProps) {
  return (
    <div className="grid grid-cols-[minmax(0,2fr)_1fr_1fr_1fr_1fr_1fr] gap-x-2.5 h-12 items-center px-4 border-b border-[var(--alpha-8)] last:border-b-0">
      {/* Model with Toggle */}
      <div className="flex items-center gap-3 min-w-0">
        <Switch checked={isEnabled} onCheckedChange={() => onToggle(model.modelId, isEnabled)} />
        <span className="text-sm text-foreground truncate" title={model.modelName}>
          {model.modelName}
        </span>
      </div>

      {/* Input Modalities */}
      <div
        className="text-sm leading-5 text-foreground truncate"
        title={model.inputModality.map(formatModality).join(' / ')}
      >
        {model.inputModality.map(formatModality).join(' / ')}
      </div>

      {/* Input Price */}
      <div className="text-sm leading-5 text-foreground" title={formatPrice(model.inputPrice)}>
        {formatPrice(model.inputPrice)}
        {model.inputPrice !== undefined && model.inputPrice > 0 && (
          <span className="text-muted-foreground"> / M tokens</span>
        )}
      </div>

      {/* Output Modalities */}
      <div
        className="text-sm leading-5 text-foreground truncate"
        title={model.outputModality.map(formatModality).join(' / ')}
      >
        {model.outputModality.map(formatModality).join(' / ')}
      </div>

      {/* Output Price */}
      <div className="text-sm leading-5 text-foreground" title={formatPrice(model.outputPrice)}>
        {formatPrice(model.outputPrice)}
        {model.outputPrice !== undefined && model.outputPrice > 0 && (
          <span className="text-muted-foreground"> / M tokens</span>
        )}
      </div>

      {/* Requests Count */}
      <div
        className="text-right text-sm leading-5 text-foreground"
        title={requests > 0 ? requests.toLocaleString() : '-'}
      >
        {requests > 0 ? requests.toLocaleString() : '-'}
      </div>
    </div>
  );
}
