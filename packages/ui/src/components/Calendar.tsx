import { DayPicker, type DayPickerProps } from 'react-day-picker';
import { ChevronLeft, ChevronRight } from 'lucide-react';

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
        months: 'relative',
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
        Chevron: ({ orientation, className: chevronClass }) =>
          orientation === 'left' ? (
            <ChevronLeft className={cn('size-4', chevronClass)} />
          ) : (
            <ChevronRight className={cn('size-4', chevronClass)} />
          ),
      }}
      {...props}
    />
  );
}

export { Calendar };
