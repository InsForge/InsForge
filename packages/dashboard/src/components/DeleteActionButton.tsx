import { Button } from '@insforge/ui';

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
      variant="destructive"
      className={`h-8 rounded px-2 text-sm leading-5 whitespace-nowrap ${className}`}
      onClick={onDelete}
    >
      Delete {selectedCount} {getItemLabel(selectedCount, itemType)}
    </Button>
  );
}
