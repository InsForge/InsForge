import { Link } from 'react-router-dom';
import { ExternalLink, PanelLeftOpen, PanelRightOpen } from 'lucide-react';
import { cn } from '@/lib/utils/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/radix/Tooltip';
import { PrimaryMenuItem } from '@/lib/utils/menuItems';

interface PrimaryMenuProps {
  items: PrimaryMenuItem[];
  bottomItems?: PrimaryMenuItem[];
  activeItemId?: string | null;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export function PrimaryMenu({
  items,
  bottomItems,
  activeItemId,
  isCollapsed,
  onToggleCollapse,
}: PrimaryMenuProps) {
  const handleToggleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    onToggleCollapse();
  };

  const baseButtonClasses = cn(
    'relative h-9 rounded duration-200 ease-in-out overflow-hidden flex items-center',
    isCollapsed ? 'w-9' : 'w-full',
    'hover:bg-zinc-100 dark:hover:bg-neutral-600 text-black dark:text-neutral-400'
  );

  const MenuItem = ({ item }: { item: PrimaryMenuItem }) => {
    const isActive = item.id === activeItemId;

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to={item.href}
            className={cn(
              'flex items-center gap-3 h-9 rounded duration-200 ease-in-out',
              isCollapsed ? 'w-9 justify-center px-0' : 'w-full px-2',
              isActive
                ? 'bg-zinc-950 dark:bg-emerald-300 text-white dark:text-black'
                : 'hover:bg-zinc-100 dark:hover:bg-neutral-600 text-black dark:text-neutral-400'
            )}
          >
            <item.icon className="w-5 h-5 flex-shrink-0" />
            {!isCollapsed && <span className="font-medium text-sm truncate">{item.label}</span>}
          </Link>
        </TooltipTrigger>
        {isCollapsed && (
          <TooltipContent side="right">
            <p>{item.label}</p>
          </TooltipContent>
        )}
      </Tooltip>
    );
  };

  const BottomMenuItem = ({ item }: { item: PrimaryMenuItem }) => {
    // For items with onClick handler or external links, use a button
    if (item.onClick || item.external) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className={baseButtonClasses}
              onClick={
                item.onClick || (item.external ? () => window.open(item.href, '_blank') : undefined)
              }
            >
              <div className="absolute left-2 h-5 w-5">
                <item.icon className="w-5 h-5" />
              </div>
              {!isCollapsed && (
                <>
                  <span className="font-medium text-sm truncate ml-9 mr-2 block text-left">
                    {item.label}
                  </span>
                  {item.external && (
                    <ExternalLink className="absolute left-40 h-4 w-4 text-neutral-500" />
                  )}
                </>
              )}
            </button>
          </TooltipTrigger>
          {isCollapsed && (
            <TooltipContent side="right">
              <div className="flex items-center gap-2">
                <p>{item.label}</p>
                {item.external && <ExternalLink className="h-3 w-3" />}
              </div>
            </TooltipContent>
          )}
        </Tooltip>
      );
    }

    // For internal navigation, use a Link
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Link to={item.href} className={baseButtonClasses}>
            <div className="absolute left-2 h-5 w-5">
              <item.icon className="w-5 h-5" />
            </div>
            {!isCollapsed && (
              <span className="font-medium text-sm truncate ml-9 mr-2 block text-left">
                {item.label}
              </span>
            )}
          </Link>
        </TooltipTrigger>
        {isCollapsed && (
          <TooltipContent side="right">
            <p>{item.label}</p>
          </TooltipContent>
        )}
      </Tooltip>
    );
  };

  return (
    <TooltipProvider disableHoverableContent delayDuration={300}>
      <aside
        className={cn(
          'bg-white dark:bg-neutral-800 border-r border-gray-200 dark:border-neutral-700 flex flex-col flex-shrink-0 pt-2 pb-6 px-2',
          'transition-[width] duration-300 ease-in-out overflow-hidden',
          isCollapsed ? 'w-[52px]' : 'w-[200px]'
        )}
      >
        {/* Top navigation items with separators */}
        <nav className="flex flex-col gap-2 overflow-y-auto thin-scrollbar">
          {items.map((item) => (
            <div key={item.id}>
              <MenuItem item={item} />
              {item.sectionEnd && <div className="h-px bg-neutral-700 my-2" />}
            </div>
          ))}
        </nav>

        {/* Spacer to push bottom items down */}
        <div className="flex-1" />

        {/* Bottom items */}
        <div className="flex flex-col gap-2">
          {bottomItems?.map((item) => (
            <BottomMenuItem key={item.id} item={item} />
          ))}

          {/* Collapse/Expand toggle button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button className={baseButtonClasses} onClick={handleToggleClick}>
                <div className="absolute left-2 h-5 w-5">
                  {isCollapsed ? (
                    <PanelLeftOpen className="w-5 h-5" />
                  ) : (
                    <PanelRightOpen className="w-5 h-5" />
                  )}
                </div>
                {!isCollapsed && (
                  <span className="font-medium text-sm truncate ml-9 mr-2 block text-left">
                    Collapse
                  </span>
                )}
              </button>
            </TooltipTrigger>
            {isCollapsed && (
              <TooltipContent side="right">
                <p>Expand</p>
              </TooltipContent>
            )}
          </Tooltip>
        </div>
      </aside>
    </TooltipProvider>
  );
}
