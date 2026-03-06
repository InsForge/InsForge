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
      'group flex items-center rounded-lg transition-all duration-150 active:scale-[0.98]',
      isCollapsed ? 'h-8 w-8 justify-center' : 'h-8 w-full gap-1 p-1.5',
      isActive
        ? 'bg-alpha-8 text-foreground'
        : 'text-muted-foreground hover:bg-alpha-4 hover:text-foreground'
    );

  const MenuItemLabel = ({ label, isActive }: { label: string; isActive: boolean }) => (
    <span
      className={cn(
        'min-w-0 truncate px-2 text-sm font-medium leading-5',
        isActive ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground'
      )}
    >
      {label}
    </span>
  );

  const MenuItemIcon = ({ item, isActive }: { item: PrimaryMenuItem; isActive: boolean }) => (
    <item.icon
      strokeWidth={1.5}
      className={cn(
        'h-5 w-5 shrink-0',
        isActive ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground'
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

  const ToggleButton = () => (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={handleToggleClick}
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!isCollapsed}
          className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground transition-all duration-150 hover:bg-alpha-4 hover:text-foreground active:scale-[0.98]"
        >
          {isCollapsed ? (
            <PanelLeftOpen strokeWidth={1.5} className="h-5 w-5" />
          ) : (
            <PanelRightOpen strokeWidth={1.5} className="h-5 w-5" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">
        <p>{isCollapsed ? 'Expand' : 'Collapse'}</p>
      </TooltipContent>
    </Tooltip>
  );

  const bottomItemsList = bottomItems ?? [];

  return (
    <TooltipProvider disableHoverableContent delayDuration={300}>
      <aside
        className={cn(
          'bg-card border-r border-border h-full flex flex-col flex-shrink-0 px-2 pt-3 pb-2',
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

        {/* Bottom items + toggle */}
        <div className="w-full space-y-1.5">
          {bottomItemsList.map((item) => (
            <MenuItem key={item.id} item={item} isBottom />
          ))}
          <ToggleButton />
        </div>
      </aside>
    </TooltipProvider>
  );
}
