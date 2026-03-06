import { useMemo, useState, type ReactNode } from 'react';
import { Link, useMatch } from 'react-router-dom';
import { LucideIcon, MoreVertical } from 'lucide-react';
import { cn } from '@/lib/utils/utils';
import { ScrollArea } from '@/components/radix/ScrollArea';
import { SecondaryMenuItem as SecondaryMenuItemType } from '@/lib/utils/menuItems';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  SearchInput,
} from '@insforge/ui';

interface SecondaryMenuProps {
  title: string;
  items: SecondaryMenuListItem[];
  loading?: boolean;
  headerButtons?: SecondaryMenuHeaderButton[];
  actionButtons?: SecondaryMenuActionButton[];
  emptyState?: ReactNode;
  activeItemId?: string | null;
  showSearch?: boolean;
  searchPlaceholder?: string;
  onSearchChange?: (value: string) => void;
  showItemMenuButton?: boolean;
  onItemMenuClick?: (item: SecondaryMenuListItem) => void;
  itemActions?: (item: SecondaryMenuListItem) => SecondaryMenuItemAction[];
}

export interface SecondaryMenuHeaderButton {
  id: string;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
}

export interface SecondaryMenuActionButton {
  id: string;
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
}

export interface SecondaryMenuItemAction {
  id: string;
  label: string;
  icon?: LucideIcon;
  destructive?: boolean;
  onClick: (item: SecondaryMenuListItem) => void;
}

export type SecondaryMenuListItem = Omit<SecondaryMenuItemType, 'href'> & {
  href?: string;
  onClick?: () => void;
};

interface SecondaryMenuItemProps {
  item: SecondaryMenuListItem;
  activeItemId?: string | null;
  showItemMenuButton?: boolean;
  onItemMenuClick?: (item: SecondaryMenuListItem) => void;
  itemActions?: (item: SecondaryMenuListItem) => SecondaryMenuItemAction[];
}

function SecondaryMenuItem({
  item,
  activeItemId,
  showItemMenuButton,
  onItemMenuClick,
  itemActions,
}: SecondaryMenuItemProps) {
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
          'group flex w-full items-center gap-1 rounded-lg px-1.5 transition-colors',
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
            <p className={cn('truncate text-sm font-medium leading-5', isSelected && 'text-inherit')}>
              {item.label}
            </p>
          </Link>
        ) : (
          <div
            className="h-auto min-w-0 flex-1 justify-start pl-2 pr-1 py-1.5 text-left text-sm leading-5 text-inherit cursor-pointer"
            onClick={handleItemClick}
          >
            <p className="truncate font-medium">{item.label}</p>
          </div>
        )}

        {menuActions.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button
                variant="ghost"
                size="icon-sm"
                className={cn(
                  'h-6 w-6 rounded-lg p-0',
                  'hover:before:bg-transparent active:before:bg-transparent',
                  isSelected
                    ? 'text-muted-foreground/50 opacity-100'
                    : 'text-muted-foreground/40 opacity-0 group-hover:opacity-100'
                )}
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-40" sideOffset={6}>
              {menuActions.map((action) => (
                <DropdownMenuItem
                  key={action.id}
                  className={cn('cursor-pointer [&_svg]:size-3.5', action.destructive && 'text-destructive')}
                  onClick={(e) => {
                    e.stopPropagation();
                    action.onClick(item);
                  }}
                >
                  {action.icon && <action.icon strokeWidth={1} />}
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
                'h-6 w-6 rounded-lg p-0',
                'hover:before:bg-transparent active:before:bg-transparent',
                isSelected
                  ? 'text-muted-foreground/50 opacity-100'
                  : 'text-muted-foreground/40 opacity-0 group-hover:opacity-100'
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

export function SecondaryMenu({
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
}: SecondaryMenuProps) {
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
        'w-60 h-full min-h-0 flex flex-col border-r border-border bg-card flex-shrink-0',
        'transition-[width] duration-300 ease-in-out'
      )}
    >
      {/* Header */}
      <div className="flex h-[57px] shrink-0 items-center justify-between border-b border-[var(--alpha-8)] pl-4 pr-3 py-3">
        <p className="truncate text-base font-medium leading-7 text-foreground">{title}</p>
        {!!headerButtons?.length && (
          <div className="flex items-center">
            {headerButtons.map((button) => (
              <Button
                key={button.id}
                variant="ghost"
                size="icon-lg"
                className="h-9 w-9 rounded-lg text-muted-foreground hover:bg-alpha-8 hover:text-foreground"
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

      {/* Scrollable content */}
      <ScrollArea className="flex-1 px-3 py-3">
        <div className="flex flex-col gap-1.5">
          {/* Action Buttons */}
          {!!actionButtons?.length &&
            actionButtons.map((button) => (
              <Button
                key={button.id}
                variant="outline-muted"
                className="h-8 w-full px-2.5 text-xs"
                onClick={button.onClick}
                disabled={button.disabled}
              >
                {button.icon && <button.icon strokeWidth={1.5} className="h-3.5 w-3.5" />}
                {button.label}
              </Button>
            ))}

          {/* Search */}
          {showSearch && (
            <SearchInput
              value={searchValue}
              onChange={handleSearchChange}
              placeholder={searchPlaceholder}
              debounceTime={0}
            />
          )}

          {/* Item List */}
          {loading ? (
            [...Array(5)].map((_, i) => (
              <div key={i} className="h-9 w-full rounded-lg bg-alpha-8 animate-pulse" />
            ))
          ) : filteredItems.length === 0 ? (
            hasSearchQuery || !emptyState ? (
              <div className="px-2 py-1 text-sm text-muted-foreground">No results found</div>
            ) : (
              emptyState
            )
          ) : (
            filteredItems.map((item) => (
              <SecondaryMenuItem
                key={item.id}
                item={item}
                activeItemId={activeItemId}
                showItemMenuButton={showItemMenuButton}
                onItemMenuClick={onItemMenuClick}
                itemActions={itemActions}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}
