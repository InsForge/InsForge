import { Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export default function ScheduleEmptyState() {
  const { t } = useTranslation('chrome');
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center gap-3 rounded-lg bg-[var(--alpha-4)]">
      <Clock size={40} className="text-muted-foreground" />
      <div className="flex flex-col items-center justify-center gap-1">
        <p className="text-sm font-medium text-foreground">
          {t('functions.noSchedulesTitle', { defaultValue: 'No schedules configured' })}
        </p>
        <p className="text-muted-foreground text-sm">
          {t('functions.noSchedulesDescription', {
            defaultValue: 'Create cron jobs to run your edge functions on a schedule',
          })}
        </p>
      </div>
    </div>
  );
}
