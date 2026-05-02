import { useMemo, useState, type ReactNode } from 'react';
import { Link, useMatch } from 'react-router-dom';
import { LucideIcon, MoreVertical } from 'lucide-react';
import { cn } from '#lib/utils/utils';
import { ScrollArea } from './radix/ScrollArea';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  SearchInput,
} from '@insforge/ui';

interface FeatureSidebarProps {
  title: string;
  items: FeatureSidebarListItem[];
  loading?: boolean;
  headerButtons?: FeatureSidebarHeaderButton[];
  actionButtons?: FeatureSidebarActionButton[];
  emptyState?: ReactNode;
  activeItemId?: string | null;
  showSearch?: boolean;
  searchPlaceholder?: string;
  onSearchChange?: (value: string) => void;
  showItemMenuButton?: boolean;
  onItemMenuClick?: (item: FeatureSidebarListItem) => void;
  itemActions?: (item: FeatureSidebarListItem) => FeatureSidebarItemAction[];
}

export interface FeatureSidebarHeaderButton {
  id: string;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
}

export interface FeatureSidebarActionButton {
  id: string;
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
}

export interface FeatureSidebarItemAction {
  id: string;
  label: string;
  icon?: LucideIcon;
  destructive?: boolean;
  onClick: (item: FeatureSidebarListItem) => void;
}

export interface FeatureSidebarListItem {
  id: string;
  label: string;
  href?: string;
  sectionEnd?: boolean;
  onClick?: () => void;
}

interface FeatureSidebarItemProps {
  item: FeatureSidebarListItem;
  activeItemId?: string | null;
  showItemMenuButton?: boolean;
  onItemMenuClick?: (item: FeatureSidebarListItem) => void;
  itemActions?: (item: FeatureSidebarListItem) => FeatureSidebarItemAction[];
}

function FeatureSidebarItemRow({
  item,
  activeItemId,
  showItemMenuButton,
  onItemMenuClick,
  itemActions,
}: FeatureSidebarItemProps) {
  // Each item determines its own active state using React Router's useMatch
  const match = useMatch({ path: item.href ?? '/__secondary_menu_no_match__', end: false });
  const hasExternalActiveItem = activeItemId !== null && activeItemId !== undefined;
  const isSelected = hasExternalActiveItem ? item.id === activeItemId : !!match;
  const menuActions = itemActions?.(item) ?? [];

  const handleItemClick = () => {
    item.onClick?.();
  };

  return (
    <>
      <div
        className={cn(
          'flex w-full items-center gap-1 rounded px-1.5 transition-colors',
          isSelected
            ? 'bg-alpha-8 text-foreground'
            : 'text-muted-foreground hover:bg-alpha-4 hover:text-foreground'
        )}
      >
        {item.href ? (
          <Link
            to={item.href}
            onClick={handleItemClick}
            className="flex min-w-0 flex-1 items-center px-2 py-1.5"
          >
            <p className={cn('truncate text-sm leading-5', isSelected && 'text-inherit')}>
              {item.label}
            </p>
          </Link>
        ) : (
          <div
            className="h-auto min-w-0 flex-1 justify-start pl-2 pr-1 py-1.5 text-left text-sm leading-5 text-inherit cursor-pointer"
            onClick={handleItemClick}
          >
            <p className="truncate">{item.label}</p>
          </div>
        )}

        {menuActions.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button
                variant="ghost"
                size="icon-sm"
                className={cn(
                  'h-6 w-6 rounded p-0',
                  isSelected
                    ? 'text-foreground hover:bg-alpha-8'
                    : 'text-muted-foreground hover:bg-alpha-8'
                )}
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              {menuActions.map((action) => (
                <DropdownMenuItem
                  key={action.id}
                  className={cn('cursor-pointer', action.destructive && 'text-destructive')}
                  onClick={(e) => {
                    e.stopPropagation();
                    action.onClick(item);
                  }}
                >
                  {action.icon && <action.icon className="mr-2 h-4 w-4" />}
                  {action.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          showItemMenuButton && (
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn(
                'h-6 w-6 rounded p-0',
                isSelected
                  ? 'text-foreground hover:bg-alpha-8'
                  : 'text-muted-foreground hover:bg-alpha-8'
              )}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onItemMenuClick?.(item);
              }}
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          )
        )}
      </div>

      {item.sectionEnd && <div className="my-1.5 h-px w-full bg-alpha-8" />}
    </>
  );
}

export function FeatureSidebar({
  title,
  items,
  loading,
  headerButtons,
  actionButtons,
  emptyState,
  activeItemId,
  showSearch = false,
  searchPlaceholder = 'Search...',
  onSearchChange,
  showItemMenuButton = false,
  onItemMenuClick,
  itemActions,
}: FeatureSidebarProps) {
  const [searchValue, setSearchValue] = useState('');
  const hasSearchQuery = showSearch && searchValue.trim().length > 0;

  const filteredItems = useMemo(() => {
    if (!showSearch || !searchValue.trim()) {
      return items;
    }

    const normalizedSearch = searchValue.toLowerCase().replace(/\s+/g, '');
    return items.filter((item) =>
      item.label.toLowerCase().replace(/\s+/g, '').includes(normalizedSearch)
    );
  }, [items, searchValue, showSearch]);

  const handleSearchChange = (value: string) => {
    setSearchValue(value);
    onSearchChange?.(value);
  };

  return (
    <aside
      className={cn(
        'w-60 h-full min-h-0 flex flex-col border-r border-[var(--alpha-8)] bg-semantic-1 flex-shrink-0',
        'transition-all duration-300 ease-in-out'
      )}
    >
      {/* Header */}
      <div className="flex h-14 items-center justify-between pl-4 pr-3 py-3">
        <p className="truncate text-base font-medium leading-7 text-foreground">{title}</p>
        {!!headerButtons?.length && (
          <div className="flex items-center">
            {headerButtons.map((button) => (
              <Button
                key={button.id}
                variant="ghost"
                size="icon-lg"
                className="h-9 w-9 rounded text-muted-foreground hover:bg-alpha-8 hover:text-foreground"
                aria-label={button.label}
                title={button.label}
                onClick={button.onClick}
                disabled={button.disabled}
              >
                <button.icon className="h-5 w-5" />
              </Button>
            ))}
          </div>
        )}
      </div>

      {/* Action Buttons */}
      {!!actionButtons?.length && (
        <div className="px-3 pb-3">
          <div className="flex flex-col gap-2">
            {actionButtons.map((button) => (
              <Button
                key={button.id}
                variant="secondary"
                className="h-8 w-full justify-start gap-1.5 rounded border-alpha-8 px-2 text-sm leading-5 font-medium"
                onClick={button.onClick}
                disabled={button.disabled}
              >
                {button.icon && <button.icon className="h-5 w-5" />}
                <span className="truncate">{button.label}</span>
              </Button>
            ))}
          </div>
          <div className="mt-3 h-px w-full bg-alpha-8" />
        </div>
      )}

      {/* Search */}
      {showSearch && (
        <div className={cn('px-3 pb-3', !actionButtons?.length && 'pt-0')}>
          <SearchInput
            value={searchValue}
            onChange={handleSearchChange}
            placeholder={searchPlaceholder}
            debounceTime={0}
          />
        </div>
      )}

      {/* Item List */}
      <ScrollArea className="flex-1 px-3 pb-2">
        {loading ? (
          <div className="flex flex-col gap-1.5">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-9 w-full rounded bg-alpha-8 animate-pulse" />
            ))}
          </div>
        ) : filteredItems.length === 0 ? (
          hasSearchQuery ? (
            <div className="px-2 py-1 text-sm text-muted-foreground">No results found</div>
          ) : (
            (emptyState ?? null)
          )
        ) : (
          <div className="flex flex-col gap-1.5">
            {filteredItems.map((item) => (
              <FeatureSidebarItemRow
                key={item.id}
                item={item}
                activeItemId={activeItemId}
                showItemMenuButton={showItemMenuButton}
                onItemMenuClick={onItemMenuClick}
                itemActions={itemActions}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </aside>
  );
}
