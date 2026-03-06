import { Link } from 'react-router-dom';
import { ExternalLink, PanelLeftOpen, PanelRightOpen } from 'lucide-react';
import { cn } from '@/lib/utils/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@insforge/ui';
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

  const menuItemBaseClasses = (isActive: boolean) =>
    cn(
      'group flex items-center rounded transition-colors',
      isCollapsed ? 'h-8 w-9 justify-center p-1.5' : 'h-8 w-full gap-1 p-1.5',
      isActive
        ? 'bg-toast text-foreground'
        : 'text-muted-foreground hover:bg-alpha-4 hover:text-foreground'
    );

  const MenuItemLabel = ({ label, isActive }: { label: string; isActive: boolean }) => (
    <span
      className={cn(
        'min-w-0 truncate px-2 text-sm font-normal leading-5',
        isActive ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground'
      )}
    >
      {label}
    </span>
  );

  const MenuItemIcon = ({ item, isActive }: { item: PrimaryMenuItem; isActive: boolean }) => (
    <item.icon
      className={cn(
        'h-5 w-5 shrink-0',
        isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'
      )}
    />
  );

  const MenuItem = ({ item, isBottom = false }: { item: PrimaryMenuItem; isBottom?: boolean }) => {
    const isActive = item.id === activeItemId;
    const itemClasses = menuItemBaseClasses(isActive);

    const content = (
      <>
        <MenuItemIcon item={item} isActive={isActive} />
        {!isCollapsed && <MenuItemLabel label={item.label} isActive={isActive} />}
        {!isCollapsed && isBottom && item.external && (
          <ExternalLink className="ml-auto h-4 w-4 text-muted-foreground" />
        )}
      </>
    );

    if (item.onClick || item.external) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={itemClasses}
              onClick={
                item.onClick || (item.external ? () => window.open(item.href, '_blank') : undefined)
              }
            >
              {content}
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

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Link to={item.href} className={itemClasses}>
            {content}
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

  const ToggleButton = ({ compact = false }: { compact?: boolean }) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={handleToggleClick}
          className={cn(
            'flex items-center justify-center rounded text-muted-foreground transition-colors hover:bg-alpha-8 hover:text-foreground',
            compact ? 'h-6 w-6' : 'h-9 w-9 p-1.5'
          )}
        >
          {isCollapsed ? (
            <PanelLeftOpen className="h-5 w-5" />
          ) : (
            <PanelRightOpen className="h-5 w-5" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">
        <p>{isCollapsed ? 'Expand' : 'Collapse'}</p>
      </TooltipContent>
    </Tooltip>
  );

  const bottomItemsList = bottomItems ?? [];
  const useInlineToggle = !isCollapsed && bottomItemsList.length === 1;

  return (
    <TooltipProvider disableHoverableContent delayDuration={300}>
      <aside
        className={cn(
          'bg-semantic-2 border-r border-border h-full flex flex-col flex-shrink-0 px-2 pt-3 pb-2',
          'transition-[width] duration-300 ease-in-out overflow-hidden',
          isCollapsed ? 'w-[52px]' : 'w-[200px]'
        )}
      >
        {/* Top navigation items with separators */}
        <nav className="flex min-h-0 flex-col gap-1.5 overflow-y-auto overflow-x-hidden w-full">
          {items.map((item) => (
            <div key={item.id}>
              <MenuItem item={item} />
              {item.sectionEnd && <div className="my-1.5 h-px w-full bg-alpha-8" />}
            </div>
          ))}
        </nav>

        {/* Spacer to push bottom items down */}
        <div className="flex-1" />

        {/* Bottom items */}
        <div className={cn('w-full', isCollapsed ? 'space-y-2' : 'space-y-1.5')}>
          {useInlineToggle ? (
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <MenuItem item={bottomItemsList[0]} isBottom />
              </div>
              <ToggleButton compact />
            </div>
          ) : (
            <>
              {bottomItemsList.map((item) => (
                <MenuItem key={item.id} item={item} isBottom />
              ))}
              <div className={cn('flex', isCollapsed ? 'justify-center' : 'justify-start')}>
                <ToggleButton compact={!isCollapsed} />
              </div>
            </>
          )}
        </div>
      </aside>
    </TooltipProvider>
  );
}
