import { useEffect, useState } from 'react';
import { cn } from '@insforge/ui';
import type { MarketplacePlugin } from '@insforge/shared-schemas';

// Tints for the letter-avatar fallback, picked deterministically per plugin
// so the marketplace stays colorful without the catalog carrying colors
const FALLBACK_TINTS = [
  'oklch(0.72 0.16 280)',
  'oklch(0.8 0.12 165)',
  'oklch(0.78 0.1 220)',
  'oklch(0.75 0.13 55)',
  'oklch(0.72 0.14 305)',
  'oklch(0.72 0.15 335)',
  'oklch(0.7 0.15 250)',
  'oklch(0.68 0.19 25)',
];

function fallbackTint(slug: string): string {
  let hash = 0;
  for (const char of slug) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return FALLBACK_TINTS[hash % FALLBACK_TINTS.length];
}

interface PluginAvatarProps {
  plugin: Pick<MarketplacePlugin, 'slug' | 'name' | 'iconUrl'>;
  size: 'sm' | 'lg';
}

export function PluginAvatar({ plugin, size }: PluginAvatarProps) {
  const [iconFailed, setIconFailed] = useState(false);

  useEffect(() => {
    setIconFailed(false);
  }, [plugin.iconUrl]);

  const showIcon = !!plugin.iconUrl && !iconFailed;

  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center font-semibold',
        // Brand logos sit on white in both themes so their colors read
        // correctly; the letter fallback keeps the theme surface
        showIcon ? 'border border-[var(--border)] bg-white' : 'bg-[rgb(var(--semantic-5))]',
        size === 'sm' ? 'h-10 w-10 rounded-lg text-lg' : 'h-11 w-11 rounded-[10px] text-xl'
      )}
      style={showIcon ? undefined : { color: fallbackTint(plugin.slug) }}
    >
      {showIcon ? (
        <img
          src={plugin.iconUrl}
          alt={`${plugin.name} logo`}
          referrerPolicy="no-referrer"
          className={cn('object-contain', size === 'sm' ? 'h-5 w-5' : 'h-6 w-6')}
          onError={() => setIconFailed(true)}
        />
      ) : (
        plugin.name.charAt(0).toUpperCase()
      )}
    </div>
  );
}
