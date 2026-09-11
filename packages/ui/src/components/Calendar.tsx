import { DayPicker, type DayPickerProps } from 'react-day-picker';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';

import { cn } from '../lib/utils';

/**
 * A month grid for picking dates.
 *
 * react-day-picker's own stylesheet is deliberately not imported — every element that needs layout
 * is given a class here, so the default CSS would only add rules to fight.
 */
function Calendar({ className, classNames, ...props }: DayPickerProps) {
  return (
    <DayPicker
      className={cn('w-fit', className)}
      classNames={{
        // flex+gap so numberOfMonths > 1 lays out side by side instead of stacking flush; relative
        // because the single shared nav is absolutely positioned across the whole set.
        months: 'relative flex gap-4',
        month: 'flex flex-col gap-2',
        month_caption: 'flex h-8 items-center justify-center',
        caption_label: 'text-sm font-medium text-foreground',
        // Absolute so the month name stays optically centred whatever its length.
        nav: 'absolute inset-x-0 top-0 flex h-8 items-center justify-between',
        button_previous:
          'flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-alpha-8 hover:text-foreground disabled:opacity-40',
        button_next:
          'flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-alpha-8 hover:text-foreground disabled:opacity-40',
        month_grid: 'border-collapse',
        weekdays: 'flex',
        weekday: 'w-8 text-xs font-normal text-muted-foreground',
        week: 'flex w-full',
        day: 'size-8 p-0 text-center text-sm',
        day_button:
          'size-8 rounded text-foreground transition-colors hover:bg-alpha-8 disabled:pointer-events-none disabled:opacity-40',
        // States dress the cell, so reach through to the button that draws the day.
        selected:
          '[&>button]:bg-[rgb(var(--foreground))] [&>button]:font-medium [&>button]:text-[rgb(var(--inverse))]',
        today: '[&>button]:font-semibold',
        outside: '[&>button]:text-muted-foreground/60',
        disabled: 'opacity-40',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        // All four orientations: nav asks for left/right, but a dropdown caption asks for down,
        // and folding every non-left case into ChevronRight points those the wrong way.
        Chevron: ({ orientation = 'down', className: chevronClass }) => {
          const Icon = { left: ChevronLeft, right: ChevronRight, up: ChevronUp, down: ChevronDown }[
            orientation
          ];
          return <Icon className={cn('size-4', chevronClass)} />;
        },
      }}
      {...props}
    />
  );
}

export { Calendar };
