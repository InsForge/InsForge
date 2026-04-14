import { Clock } from 'lucide-react';

export default function ScheduleEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center gap-3 rounded-lg bg-[var(--alpha-4)]">
      <Clock size={40} className="text-muted-foreground" />
      <div className="flex flex-col items-center justify-center gap-1">
        <p className="text-sm font-medium text-foreground">No schedules configured</p>
        <p className="text-muted-foreground text-sm">
          Create cron jobs to run your edge functions on a schedule
        </p>
      </div>
    </div>
  );
}
