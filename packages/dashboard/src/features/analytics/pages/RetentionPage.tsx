import { RequirePosthogConnection } from '#features/analytics/components/RequirePosthogConnection';
import { RetentionCard } from '#features/analytics/components/posthog/RetentionCard';

export function RetentionPage() {
  return (
    <RequirePosthogConnection>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center justify-between border-b border-[var(--alpha-8)] bg-semantic-0 py-3 pl-4 pr-3">
          <h1 className="text-base font-medium text-foreground">User Retention</h1>
          <span className="text-sm text-muted-foreground">Weekly cohort - 8 weeks</span>
        </div>

        <div className="flex-1 overflow-auto">
          <RetentionCard enabled />
        </div>
      </div>
    </RequirePosthogConnection>
  );
}
