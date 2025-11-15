import { CronJobsContent } from '@/features/functions/components/CronJobsContent';

export default function SchedulesPage() {
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-1 p-4">
        <CronJobsContent />
      </div>
    </div>
  );
}
