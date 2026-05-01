import type { PosthogTimeframe } from '@insforge/shared-schemas';
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

  return (
    <select
      className="rounded-md border bg-card px-3 py-1.5 text-sm text-foreground"
      value={timeframe}
      onChange={(e) => setTimeframe(e.target.value as PosthogTimeframe)}
    >
      {OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
