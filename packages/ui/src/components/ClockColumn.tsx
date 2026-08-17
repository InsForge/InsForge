import * as React from 'react';

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
  const selectedRef = React.useRef<HTMLButtonElement | null>(null);

  // The current row is rarely near the top of 24, let alone 60. Keyed on the selection, not done in
  // a callback ref: a ref recreated each render detaches and reattaches on every parent render,
  // which would yank the column back to the selected row while someone is scrolling it.
  React.useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'center' });
  }, [selected]);

  return (
    <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
      {options.map((option) => {
        const isSelected = option === selected;
        return (
          <button
            key={option}
            type="button"
            // Colour alone does not tell assistive tech which row is current.
            aria-pressed={isSelected}
            ref={isSelected ? selectedRef : undefined}
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
