import { TableHeader } from '#components';
import { RequirePosthogConnection } from '#features/analytics/components/RequirePosthogConnection';
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
        <RequirePosthogConnection>
          <RetentionCard enabled />
        </RequirePosthogConnection>
      </div>
    </div>
  );
}
