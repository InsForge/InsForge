import { Button } from '@insforge/ui';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface SelectionClearButtonProps {
  selectedCount: number;
  itemType: string;
  onClear: () => void;
}

const KNOWN_ITEM_TYPES = ['user', 'record', 'file'] as const;

export function SelectionClearButton({
  selectedCount,
  itemType,
  onClear,
}: SelectionClearButtonProps) {
  const { t } = useTranslation('chrome');
  const isPlural = selectedCount > 1;
  const englishFallback = `${selectedCount} ${isPlural ? `${itemType}s` : itemType} selected`;
  const displayText = (KNOWN_ITEM_TYPES as readonly string[]).includes(itemType)
    ? t(`common.selectedItems.${itemType}`, { count: selectedCount, defaultValue: englishFallback })
    : englishFallback;

  return (
    <Button
      variant="ghost"
      size="default"
      className="h-8 rounded border border-[var(--alpha-8)] bg-[var(--alpha-4)] px-2 text-foreground whitespace-nowrap hover:bg-[var(--alpha-8)] active:bg-[var(--alpha-12)]"
      onClick={() => onClear()}
    >
      <span className="text-sm leading-5">{displayText}</span>
      <X className="h-4 w-4 text-muted-foreground" />
    </Button>
  );
}
