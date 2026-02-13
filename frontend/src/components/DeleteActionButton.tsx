import { Button } from '@insforge/ui';
import { useTheme } from '@/lib/contexts/ThemeContext';

interface DeleteActionButtonProps {
  selectedCount: number;
  itemType: string;
  onDelete: () => void;
  className?: string;
}

export function DeleteActionButton({
  selectedCount,
  itemType,
  onDelete,
  className = '',
}: DeleteActionButtonProps) {
  const { resolvedTheme } = useTheme();

  const getItemLabel = (count: number, type: string) => {
    const singular = type.charAt(0).toUpperCase() + type.slice(1);
    const plural =
      type === 'user'
        ? 'Users'
        : type === 'record'
          ? 'Records'
          : type === 'file'
            ? 'Files'
            : `${singular}s`;

    return count === 1 ? singular : plural;
  };

  return (
    <Button
      variant={resolvedTheme === 'light' ? 'outline' : 'primary'}
      className={`h-10 px-3 text-sm text-red-600 hover:text-red-400 hover:bg-zinc-50 border border-border-gray shadow-0 dark:bg-red-200 dark:text-red-600 dark:border-transparent dark:hover:bg-red-300 ${className}`}
      onClick={onDelete}
    >
      Delete {selectedCount} {getItemLabel(selectedCount, itemType)}
    </Button>
  );
}
