import type { PosthogTimeframe } from '@insforge/shared-schemas';
import { ChevronDown } from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@insforge/ui';
import { useTimeframe, useSetTimeframe } from '../../context/TimeRangeContext';

const OPTIONS: Array<{ value: PosthogTimeframe; label: string }> = [
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '3m', label: 'Last 3 months' },
];

export function TimeRangeSelector() {
  const timeframe = useTimeframe();
  const setTimeframe = useSetTimeframe();
  const current = OPTIONS.find((o) => o.value === timeframe) ?? OPTIONS[1];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" className="h-9 rounded px-3 text-foreground">
          {current.label}
          <ChevronDown className="ml-1 h-4 w-4 stroke-[1.7]" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48 p-1.5">
        {OPTIONS.map((opt) => (
          <DropdownMenuItem
            key={opt.value}
            onClick={() => setTimeframe(opt.value)}
            className="cursor-pointer px-2 py-1.5"
          >
            {opt.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
