import { Link, useMatch } from 'react-router-dom';
import { cn } from '@/lib/utils/utils';
import { ScrollArea } from '@/components/radix/ScrollArea';
import { SecondaryMenuItem as SecondaryMenuItemType } from '@/lib/utils/menuConfig';

interface SecondaryMenuProps {
  title: string;
  items: SecondaryMenuItemType[];
  loading?: boolean;
}

function SecondaryMenuItem({ item }: { item: SecondaryMenuItemType }) {
  // Each item determines its own active state using React Router's useMatch
  const match = useMatch({ path: item.href, end: false });
  const isSelected = !!match;

  return (
    <Link to={item.href}>
      <button
        className={cn(
          'h-8 w-full flex items-center px-3 py-1.5 rounded text-left transition-colors',
          isSelected
            ? 'bg-zinc-200 text-zinc-950 dark:bg-neutral-700 dark:text-white'
            : 'text-zinc-950 dark:text-white hover:bg-zinc-100 dark:hover:bg-neutral-700/50'
        )}
      >
        <p className="text-sm truncate">{item.label}</p>
      </button>
    </Link>
  );
}

export function SecondaryMenu({ title, items, loading }: SecondaryMenuProps) {
  return (
    <aside
      className={cn(
        'w-50 flex flex-col bg-white dark:bg-neutral-800 border-r border-gray-200 dark:border-neutral-700 flex-shrink-0',
        'transition-all duration-300 ease-in-out'
      )}
    >
      {/* Header */}
      <div className="px-3 py-3.5 bg-white dark:bg-neutral-800">
        <p className="text-base font-normal text-zinc-950 dark:text-neutral-400">{title}</p>
      </div>

      {/* Item List */}
      <ScrollArea className="flex-1 px-3 pb-3.5 dark:bg-neutral-800">
        {loading ? (
          <div className="flex flex-col space-y-2">
            {[...Array(5)].map((_, i) => (
              <div
                key={i}
                className="h-8 w-full rounded bg-zinc-100 dark:bg-neutral-700 animate-pulse"
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col space-y-2">
            {items.map((item) => (
              <SecondaryMenuItem key={item.id} item={item} />
            ))}
          </div>
        )}
      </ScrollArea>
    </aside>
  );
}
