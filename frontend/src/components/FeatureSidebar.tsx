import { useState, ReactNode } from 'react';
import { Plus, LucideIcon } from 'lucide-react';
import { ScrollArea } from '@/components/radix/ScrollArea';
import { Button } from '@/components/radix/Button';
import { SearchInput } from '@/components/SearchInput';
import { FeatureSidebarItem } from '@/components/FeatureSidebarItem';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/radix/Tooltip';

interface FeatureSidebarProps {
  title: string;
  items: string[];
  selectedItem?: string;
  onItemSelect: (itemName: string) => void;
  loading?: boolean;
  onNewItem?: () => void;
  onEditItem?: (itemName: string) => void;
  onDeleteItem?: (itemName: string) => void;
  searchPlaceholder?: string;
  newItemTooltip?: string;
  editLabel?: string;
  deleteLabel?: string;
  icon: LucideIcon;
  filterItems?: (itemNames: string[]) => string[];
  renderSkeleton: () => ReactNode;
  renderEmptyState: (searchTerm: string) => ReactNode;
}

export function FeatureSidebar({
  title,
  items,
  selectedItem,
  onItemSelect,
  loading,
  onNewItem,
  onEditItem,
  onDeleteItem,
  searchPlaceholder = 'Search...',
  newItemTooltip = 'Add new',
  editLabel = 'Edit',
  deleteLabel = 'Delete',
  icon,
  filterItems,
  renderSkeleton,
  renderEmptyState,
}: FeatureSidebarProps) {
  const [searchTerm, setSearchTerm] = useState('');

  let itemNames = items;
  if (filterItems) {
    itemNames = filterItems(itemNames);
  }

  const normalizedSearch = searchTerm.toLowerCase().replace(/\s+/g, '');
  const filteredItems = itemNames.filter((name) =>
    name.toLowerCase().replace(/\s+/g, '').includes(normalizedSearch)
  );

  return (
    <div className="w-70 flex flex-col h-full bg-white dark:bg-neutral-800 border-r border-border-gray dark:border-neutral-700">
      {/* Header */}
      <div className="flex flex-row justify-between items-center pl-4 pr-1.5 py-1.5 bg-white dark:bg-neutral-800">
        <h2 className="text-base font-bold text-black dark:text-white">{title}</h2>
        {onNewItem && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={onNewItem}
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 dark:bg-transparent dark:text-neutral-400 dark:hover:bg-neutral-700"
                >
                  <Plus className="w-5 h-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{newItemTooltip}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      {/* Add Button and Search */}
      <div className="py-2 px-3 bg-white dark:bg-neutral-800">
        <SearchInput
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder={searchPlaceholder}
          className="w-full dark:text-white"
          debounceTime={200}
        />
      </div>

      {/* Item List */}
      <ScrollArea className="flex-1 px-3 pb-3 dark:bg-neutral-800">
        {loading ? (
          renderSkeleton()
        ) : !filteredItems.length ? (
          renderEmptyState(searchTerm)
        ) : (
          <div className="space-y-1 dark:text-zinc-300">
            {filteredItems.map((itemName) => (
              <FeatureSidebarItem
                key={itemName}
                name={itemName}
                icon={icon}
                isSelected={selectedItem === itemName}
                onClick={() => onItemSelect(itemName)}
                onEdit={onEditItem ? () => onEditItem(itemName) : undefined}
                onDelete={onDeleteItem ? () => onDeleteItem(itemName) : undefined}
                editLabel={editLabel}
                deleteLabel={deleteLabel}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
