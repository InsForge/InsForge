import { Switch } from '@/components/radix/Switch';
import type { ScheduleRow } from '@/features/functions/components/CronJobsContent.js';

interface ScheduleToggleCellProps {
  row: ScheduleRow;
  isLoading: boolean;
  onToggle: (scheduleId: string, isActive: boolean) => void;
}

export function ScheduleToggleCell({ row, isLoading, onToggle }: ScheduleToggleCellProps) {
  return (
    <Switch
      checked={row.isActive}
      onCheckedChange={(checked) => onToggle(row.id, checked)}
      disabled={isLoading}
      aria-label={`Toggle ${row.name}`}
    />
  );
}
