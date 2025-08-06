import { useState, ReactNode } from 'react';
import { Plus, LucideIcon } from 'lucide-react';
import { ScrollArea } from '@/components/radix/ScrollArea';
import { Button } from '@/components/radix/Button';
import { SearchInput } from '@/components/SearchInput';
import { FeatureSidebarItem } from '@/components/FeatureSidebarItem';

interface FeatureItem {
  [key: string]: any;
}

interface FeatureSidebarProps<T extends FeatureItem> {
  title: string;
  items: Record<string, T>;
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

export function FeatureSidebar<T extends FeatureItem>({
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
}: FeatureSidebarProps<T>) {
  const [searchTerm, setSearchTerm] = useState('');

  let itemNames = Object.keys(items);
  if (filterItems) {
    itemNames = filterItems(itemNames);
  }

  const normalizedSearch = searchTerm.toLowerCase().replace(/\s+/g, '');
  const filteredItems = itemNames.filter((name) =>
    name.toLowerCase().replace(/\s+/g, '').includes(normalizedSearch)
  );

  return (
    <div className="w-70 flex flex-col h-full bg-white border-r border-border-gray">
      {/* Header */}
      <div className="px-6 py-3 h-12 bg-white border-b border-border-gray">
        <h2 className="text-base font-semibold text-black">{title}</h2>
      </div>

      {/* Add Button and Search */}
      <div className="p-3 pb-2.5 bg-white space-y-2.5">
        {onNewItem && (
          <Button
            onClick={onNewItem}
            variant="outline"
            size="sm"
            className="w-full h-10 text-sm justify-start"
          >
            <Plus className="w-5 h-5 mr-1" />
            {newItemTooltip}
          </Button>
        )}
        <SearchInput
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder={searchPlaceholder}
          className="w-full"
          debounceTime={200}
        />
      </div>

      {/* Item List */}
      <ScrollArea className="flex-1 px-3 pb-3">
        {loading ? (
          renderSkeleton()
        ) : filteredItems.length === 0 ? (
          renderEmptyState(searchTerm)
        ) : (
          <div className="space-y-1">
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
