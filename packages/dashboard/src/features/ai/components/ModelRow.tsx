import { ModelOption, formatPrice, formatModality, formatReleasedDate } from '#features/ai/helpers';

interface ModelRowProps {
  model: ModelOption;
}

export function ModelRow({ model }: ModelRowProps) {
  const Logo = model.logo;
  const releasedDate = formatReleasedDate(model.created);

  return (
    <div className="grid h-12 grid-cols-[149px_minmax(120px,1fr)_minmax(120px,1fr)_minmax(120px,1fr)_minmax(120px,1fr)_120px] items-center border-b border-[var(--alpha-8)] last:border-b-0">
      <div className="flex h-full min-w-0 items-center border-r border-[var(--alpha-8)] px-2.5">
        <div className="flex min-w-0 items-center gap-2">
          {Logo && <Logo className="h-5 w-5 shrink-0 text-foreground" />}
          <span
            className="truncate text-[13px] leading-[18px] text-foreground"
            title={model.modelName}
          >
            {model.modelName}
          </span>
        </div>
      </div>

      {/* Input Modalities */}
      <div
        className="truncate px-2.5 text-[13px] leading-[18px] text-foreground"
        title={model.inputModality.map(formatModality).join(' / ')}
      >
        {model.inputModality.map(formatModality).join(' / ')}
      </div>

      {/* Input Price */}
      <div
        className="truncate px-2.5 text-[13px] leading-[18px] text-foreground"
        title={formatPrice(model.inputPrice)}
      >
        {formatPrice(model.inputPrice)}
        {model.inputPrice !== undefined && model.inputPrice > 0 && (
          <span className="text-muted-foreground"> / M tokens</span>
        )}
      </div>

      {/* Output Modalities */}
      <div
        className="truncate px-2.5 text-[13px] leading-[18px] text-foreground"
        title={model.outputModality.map(formatModality).join(' / ')}
      >
        {model.outputModality.map(formatModality).join(' / ')}
      </div>

      {/* Output Price */}
      <div
        className="truncate px-2.5 text-[13px] leading-[18px] text-foreground"
        title={formatPrice(model.outputPrice)}
      >
        {formatPrice(model.outputPrice)}
        {model.outputPrice !== undefined && model.outputPrice > 0 && (
          <span className="text-muted-foreground"> / M tokens</span>
        )}
      </div>

      {/* Released */}
      <div
        className="truncate px-2.5 text-left text-[13px] leading-[18px] text-foreground"
        title={releasedDate}
      >
        {releasedDate}
      </div>
    </div>
  );
}
