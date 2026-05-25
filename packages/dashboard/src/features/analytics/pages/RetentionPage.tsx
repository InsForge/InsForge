import { TimeRangeSelector } from '#features/analytics/components/posthog/TimeRangeSelector';
import { RetentionCard } from '#features/analytics/components/posthog/RetentionCard';

export function RetentionPage() {
  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">User Retention</h1>
        <TimeRangeSelector />
      </div>

      <RetentionCard enabled />
    </div>
  );
}
