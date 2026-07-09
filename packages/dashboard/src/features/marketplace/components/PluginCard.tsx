import { Check } from 'lucide-react';
import { Button, cn } from '@insforge/ui';
import type { MarketplacePluginWithStatus } from '@insforge/shared-schemas';
import { PluginAvatar } from '#features/marketplace/components/PluginAvatar';

interface PluginCardProps {
  plugin: MarketplacePluginWithStatus;
  onOpen: () => void;
}

export function PluginCard({ plugin, onOpen }: PluginCardProps) {
  return (
    <div
      onClick={onOpen}
      className={cn(
        'group relative flex min-h-[148px] cursor-pointer flex-col gap-3 rounded-lg border border-[var(--border)] bg-card p-5',
        'transition-[border-color,box-shadow] duration-100',
        'hover:border-[rgb(var(--primary)/0.6)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.35)]'
      )}
    >
      <div className="pointer-events-none absolute inset-0 rounded-lg transition-colors duration-100 group-hover:bg-[var(--alpha-4)]" />
      <div className="relative">
        <div className="absolute right-0 top-0">
          {plugin.installed ? (
            <div className="flex items-center gap-1.5 text-[13px] font-medium text-primary">
              <Check className="h-[15px] w-[15px]" strokeWidth={2.5} />
              <span>Installed</span>
            </div>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              className="text-[13px] text-foreground opacity-0 transition-opacity duration-100 group-hover:opacity-100 focus-visible:opacity-100"
              onClick={(event) => {
                event.stopPropagation();
                onOpen();
              }}
            >
              Install
            </Button>
          )}
        </div>
        <div className="flex items-start gap-3 pr-[84px]">
          <PluginAvatar plugin={plugin} size="sm" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[15px] font-semibold text-foreground">{plugin.name}</span>
            <span className="text-xs text-muted-foreground">{plugin.publisher}</span>
          </div>
        </div>
      </div>
      <p className="relative m-0 flex-1 text-[13px] leading-normal text-muted-foreground">
        {plugin.description}
      </p>
    </div>
  );
}
