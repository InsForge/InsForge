import { Button } from '@insforge/ui';
import { X } from 'lucide-react';

interface SelectionClearButtonProps {
  selectedCount: number;
  itemType: string;
  onClear: () => void;
}

export function SelectionClearButton({
  selectedCount,
  itemType,
  onClear,
}: SelectionClearButtonProps) {
  const isPlural = selectedCount > 1;
  const displayText = `${selectedCount} ${isPlural ? `${itemType}s` : itemType} selected`;

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
