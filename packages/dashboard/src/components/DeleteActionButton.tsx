import { Button } from '@insforge/ui';
import { useTranslation } from 'react-i18next';

interface DeleteActionButtonProps {
  selectedCount: number;
  itemType: string;
  onDelete: () => void;
  className?: string;
}

const KNOWN_ITEM_TYPES = ['user', 'record', 'file'] as const;

export function DeleteActionButton({
  selectedCount,
  itemType,
  onDelete,
  className = '',
}: DeleteActionButtonProps) {
  const { t } = useTranslation('chrome');

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

  const englishFallback = `Delete ${selectedCount} ${getItemLabel(selectedCount, itemType)}`;
  const label = (KNOWN_ITEM_TYPES as readonly string[]).includes(itemType)
    ? t(`common.deleteItems.${itemType}`, { count: selectedCount, defaultValue: englishFallback })
    : englishFallback;

  return (
    <Button
      variant="destructive"
      className={`h-8 rounded px-2 text-sm leading-5 whitespace-nowrap ${className}`}
      onClick={onDelete}
    >
      {label}
    </Button>
  );
}
