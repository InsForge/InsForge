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
    <button
      className="flex items-center gap-1.5 h-10 px-3 rounded-[6px] bg-white border border-border-gray hover:bg-gray-50 transition-colors"
      onClick={onClear}
    >
      <p className="text-zinc-950 text-sm">{displayText}</p>
      <X className="h-4 w-4 text-gray-500" />
    </button>
  );
}
