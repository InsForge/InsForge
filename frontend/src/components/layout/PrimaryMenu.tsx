import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/radix/Tooltip';
import { PrimaryMenuItem } from '@/lib/utils/menuConfig';

interface PrimaryMenuProps {
  items: PrimaryMenuItem[];
  bottomItems?: Array<{
    id: string;
    label: string;
    href: string;
    icon: React.ComponentType<{ className?: string }>;
    external?: boolean;
  }>;
  activeItemId?: string | null;
}

export function PrimaryMenu({ items, bottomItems, activeItemId }: PrimaryMenuProps) {
  const MenuItem = ({ item }: { item: PrimaryMenuItem }) => {
    // Use the activeItemId passed from parent to determine if this item is active
    const isActive = item.id === activeItemId;

    const buttonContent = (
      <button
        className={cn(
          'w-9 h-9 flex items-center justify-center rounded transition-all duration-200 ease-in-out',
          isActive ? 'bg-emerald-300 text-black' : 'text-neutral-400 hover:bg-neutral-700'
        )}
      >
        <item.icon className="w-5 h-5" />
      </button>
    );

    return (
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Link to={item.href} className="block">
              {buttonContent}
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right">
            <p>{item.label}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  };

  return (
    <aside className="w-[52px] bg-neutral-800 border-r border-neutral-700 flex flex-col flex-shrink-0 py-2 px-2">
      {/* Top navigation items */}
      <nav className="flex flex-col gap-2">
        {items.map((item) => (
          <MenuItem key={item.id} item={item} />
        ))}
      </nav>

      {/* Spacer to push bottom items down */}
      <div className="flex-1" />

      {/* Bottom items */}
      {bottomItems && bottomItems.length > 0 && (
        <div className="flex flex-col gap-2">
          {bottomItems.map((item) => (
            <TooltipProvider key={item.id} delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className="w-9 h-9 flex items-center justify-center rounded text-neutral-400 hover:bg-neutral-700 transition-all duration-200"
                    onClick={() => window.open(item.href, '_blank')}
                  >
                    <item.icon className="w-5 h-5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <div className="flex items-center gap-2">
                    <p>{item.label}</p>
                    {item.external && <ExternalLink className="h-3 w-3" />}
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ))}
        </div>
      )}
    </aside>
  );
}
