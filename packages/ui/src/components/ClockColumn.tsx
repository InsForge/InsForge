import { cn } from '../lib/utils';

/**
 * A scrolling column of selectable units — hours, minutes, or anything else short and uniform.
 *
 * Purely presentational: the caller decides what the units are. Picking one is a finished action,
 * which is what lets a panel built from these close on a choice — unlike an `input[type=time]`,
 * which reports a change while the minutes are still half-typed.
 */
function ClockColumn({
  options,
  selected,
  onPick,
}: {
  options: readonly string[];
  selected: string;
  onPick: (value: string) => void;
}) {
  // The current row is rarely near the top of 24, let alone 60.
  const scrollSelectedIntoView = (el: HTMLButtonElement | null) =>
    el?.scrollIntoView({ block: 'center' });

  return (
    <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
      {options.map((option) => {
        const isSelected = option === selected;
        return (
          <button
            key={option}
            type="button"
            ref={isSelected ? scrollSelectedIntoView : undefined}
            onClick={() => onPick(option)}
            className={cn(
              'rounded px-2 py-1 text-sm tabular-nums transition-colors',
              isSelected
                ? 'bg-[rgb(var(--foreground))] font-medium text-[rgb(var(--inverse))]'
                : 'text-foreground hover:bg-alpha-8'
            )}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

export { ClockColumn };
