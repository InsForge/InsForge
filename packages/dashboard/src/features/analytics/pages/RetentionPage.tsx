import { TableHeader } from '#components';
import { RequireAnalyticsConnection } from '#features/analytics/components/RequireAnalyticsConnection';
import { RetentionCard } from '#features/analytics/components/posthog/RetentionCard';

export function RetentionPage() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <TableHeader
        title="User Retention"
        showSearch={false}
        rightActions={
          <span className="text-sm text-muted-foreground">Weekly cohort - 8 weeks</span>
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
