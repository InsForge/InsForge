import { useTranslation } from 'react-i18next';
import { TableHeader } from '#components';
import { RequireAnalyticsConnection } from '#features/analytics/components/RequireAnalyticsConnection';
import { RetentionCard } from '#features/analytics/components/posthog/RetentionCard';

export function RetentionPage() {
  const { t } = useTranslation('chrome');
  return (
    <div className="flex h-full min-h-0 flex-col">
      <TableHeader
        title={t('analytics.sidebar.userRetention', { defaultValue: 'User Retention' })}
        showSearch={false}
        rightActions={
          <span className="text-sm text-muted-foreground">
            {t('analytics.weeklyCohort', { defaultValue: 'Weekly cohort - 8 weeks' })}
          </span>
        }
      />
      <div className="min-h-0 flex-1 overflow-auto">
        <RequireAnalyticsConnection>
          <RetentionCard enabled />
        </RequireAnalyticsConnection>
      </div>
    </div>
  );
}
