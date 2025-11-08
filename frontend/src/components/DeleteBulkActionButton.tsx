import { CheckSquare, Square } from 'lucide-react';
import { Button } from './radix/Button';

interface DeleteBulkActionButtonProps {
  isSelectingAll: boolean;
  totalRecords: number;
  filteredRecords: number;
  searchQuery: string;
  className?: string;
  onToggleSelectAll: () => void;
}

function DeleteBulkActionButton({
  isSelectingAll,
  totalRecords,
  filteredRecords,
  searchQuery,
  onToggleSelectAll,
}: DeleteBulkActionButtonProps) {
  const isAllSelected = totalRecords > 0 && filteredRecords === totalRecords;

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onToggleSelectAll}
      disabled={isSelectingAll}
      className={`
    h-9 px-3 gap-2 font-medium transition-all
    ${
      isAllSelected
        ? 'text-orange-600 dark:text-orange-400 hover:text-orange-700 dark:hover:text-orange-300 hover:bg-orange-50 dark:hover:bg-orange-950/30'
        : 'text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/30'
    }
    ${isSelectingAll ? 'opacity-50 cursor-not-allowed' : ''}
  `}
    >
      {isSelectingAll ? (
        <>
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          <span>Selecting...</span>
        </>
      ) : isAllSelected ? (
        <>
          <CheckSquare className="h-4 w-4" />
          <span>Deselect All</span>
        </>
      ) : (
        <>
          <Square className="h-4 w-4" />
          <span>Select All {searchQuery ? 'Filtered' : totalRecords} Rows</span>
        </>
      )}
    </Button>
  );
}

export default DeleteBulkActionButton;
