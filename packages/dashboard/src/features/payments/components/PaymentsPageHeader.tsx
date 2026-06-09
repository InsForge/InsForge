import { SearchInput } from '@insforge/ui';
import { TableHeader } from '#components';

interface PaymentsPageHeaderProps {
  title: string;
  leftSlot?: React.ReactNode;
  showDividerAfterTitle?: boolean;
  showSearch?: boolean;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  searchInputClassName?: string;
  searchDebounceTime?: number;
}

export function PaymentsPageHeader({
  title,
  leftSlot,
  showDividerAfterTitle,
  showSearch = true,
  searchValue = '',
  onSearchChange,
  searchPlaceholder,
  searchInputClassName,
  searchDebounceTime,
}: PaymentsPageHeaderProps) {
  const shouldShowSearch = showSearch && !!onSearchChange;

  return (
    <TableHeader
      title={title}
      className="h-14 min-h-14"
      leftClassName="py-0"
      rightClassName="py-0"
      showDividerAfterTitle={showDividerAfterTitle}
      leftSlot={leftSlot}
      showSearch={false}
      rightActions={
        <>
          {shouldShowSearch && (
            <SearchInput
              value={searchValue}
              onChange={onSearchChange}
              placeholder={searchPlaceholder ?? 'Search'}
              debounceTime={searchDebounceTime ?? 0}
              className={searchInputClassName ?? 'w-64'}
            />
          )}
        </>
      }
    />
  );
}
