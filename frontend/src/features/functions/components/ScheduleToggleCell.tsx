import { Switch } from '@/components/radix/Switch';
import type { ScheduleRow } from '@/features/functions/types/schedules';

interface ScheduleToggleCellProps {
  row: ScheduleRow;
  isLoading: boolean;
  onToggle: (scheduleId: string, isActive: boolean) => void;
}

export function ScheduleToggleCell({ row, isLoading, onToggle }: ScheduleToggleCellProps) {
  const checked = Boolean(row.isActive);

  const handleChange = (next: boolean) => {
    // Call parent handler with the new state
    onToggle(row.id, next);
  };

  return (
    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
      <Switch
        checked={checked}
        onCheckedChange={handleChange}
        disabled={isLoading}
        aria-label={`${row.name} active toggle`}
      />
      <span className="text-sm text-zinc-600 dark:text-zinc-400 select-none">
        {checked ? 'Active' : 'Inactive'}
      </span>
    </div>
  );
}
