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
      size="icon"
      className="h-8 w-8 border border-[var(--alpha-8)] text-muted-foreground hover:text-foreground"
      onClick={() => onClear()}
      title={`Clear selection (${displayText})`}
      aria-label={`Clear selection (${displayText})`}
    >
      <X strokeWidth={1.5} className="h-4 w-4" />
    </Button>
  );
}
