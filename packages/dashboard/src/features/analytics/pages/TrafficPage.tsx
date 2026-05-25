import { Info } from 'lucide-react';
import { TimeRangeSelector } from '#features/analytics/components/posthog/TimeRangeSelector';
import { KpiSectionWithTrend } from '#features/analytics/components/posthog/KpiSectionWithTrend';
import { BreakdownPanel } from '#features/analytics/components/posthog/BreakdownPanel';

export function TrafficPage() {
  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Traffic</h1>
        <TimeRangeSelector />
      </div>

      <div className="flex items-start gap-2 px-1 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <p>
          Web Analytics aggregates session data with some delay. After connecting PostHog or
          capturing your first events, it may take a few hours for visitors, views, and sessions to
          appear here.
        </p>
      </div>

      <KpiSectionWithTrend enabled />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <BreakdownPanel breakdown="Page" enabled />
        <BreakdownPanel breakdown="Country" enabled />
        <BreakdownPanel breakdown="DeviceType" enabled />
      </div>
    </div>
  );
}
