import { TimeRangeSelector } from '#features/analytics/components/posthog/TimeRangeSelector';
import { KpiSectionWithTrend } from '#features/analytics/components/posthog/KpiSectionWithTrend';
import { BreakdownPanel } from '#features/analytics/components/posthog/BreakdownPanel';

export function TrafficPage() {
  return (
    <div className="h-full overflow-y-auto bg-[rgb(var(--semantic-1))]">
      <div className="mx-auto flex w-4/5 max-w-[1024px] flex-col gap-6 pb-10 pt-10">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-medium leading-8 text-foreground">Traffic</h1>
          <TimeRangeSelector />
        </div>

        <KpiSectionWithTrend enabled />

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <BreakdownPanel breakdown="Page" enabled />
          <BreakdownPanel breakdown="Country" enabled />
          <BreakdownPanel breakdown="DeviceType" enabled />
        </div>
      </div>
    </div>
  );
}
