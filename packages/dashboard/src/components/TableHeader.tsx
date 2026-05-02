import { SearchInput } from '@insforge/ui';
import { cn } from '#lib/utils/utils';

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
  searchDebounceTime?: number;
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
  searchDebounceTime = 0,
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
          <SearchInput
            value={searchValue}
            onChange={onSearchChange}
            placeholder={searchPlaceholder}
            debounceTime={searchDebounceTime}
            className={cn('w-64', searchInputClassName)}
          />
        )}
      </div>
    </div>
  );
}
