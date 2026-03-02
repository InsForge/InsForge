import { Search } from 'lucide-react';
import { Input } from '@insforge/ui';
import { cn } from '@/lib/utils/utils';

interface TableHeaderProps {
  title?: React.ReactNode;
  className?: string;
  leftClassName?: string;
  rightClassName?: string;
  titleClassName?: string;
  leftContent?: React.ReactNode;
  showDividerAfterTitle?: boolean;
  titleButtons?: React.ReactNode;
  leftSlot?: React.ReactNode;
  rightActions?: React.ReactNode;
  showSearch?: boolean;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  searchInputClassName?: string;
}

export function TableHeader({
  title,
  className,
  leftClassName,
  rightClassName,
  titleClassName,
  leftContent,
  showDividerAfterTitle = false,
  titleButtons,
  leftSlot,
  rightActions,
  showSearch = true,
  searchValue = '',
  onSearchChange,
  searchPlaceholder = 'Search',
  searchInputClassName,
}: TableHeaderProps) {
  const showTitleDivider = !leftContent && showDividerAfterTitle && (titleButtons || leftSlot);
  const shouldShowSearch = showSearch && !!onSearchChange;

  return (
    <div
      className={cn(
        'flex min-h-14 items-center justify-between border-b border-[var(--alpha-8)] bg-[rgb(var(--semantic-0))]',
        className
      )}
    >
      <div
        className={cn(
          'flex min-w-0 flex-1 items-center overflow-hidden pl-4 pr-3 py-3',
          !leftContent && 'gap-3',
          leftClassName
        )}
      >
        {leftContent || (
          <>
            {title !== undefined && (
              <h1
                className={cn(
                  'shrink-0 text-base font-medium leading-7 text-foreground',
                  titleClassName
                )}
              >
                {title}
              </h1>
            )}

            {showTitleDivider && (
              <div className="flex h-5 w-5 shrink-0 items-center justify-center">
                <div className="h-5 w-px bg-[var(--alpha-8)]" />
              </div>
            )}

            {titleButtons}
            {leftSlot}
          </>
        )}
      </div>

      <div className={cn('flex shrink-0 items-center gap-2 px-3 py-3', rightClassName)}>
        {rightActions}

        {shouldShowSearch && (
          <div className="relative w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchValue}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={searchPlaceholder}
              className={cn(
                'h-8 border-[var(--alpha-12)] bg-[var(--alpha-4)] pl-8 pr-2 text-[13px]',
                searchInputClassName
              )}
            />
          </div>
        )}
      </div>
    </div>
  );
}
