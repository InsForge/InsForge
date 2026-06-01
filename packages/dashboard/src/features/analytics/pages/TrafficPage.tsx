import { TableHeader } from '#components';
import { RequirePosthogConnection } from '#features/analytics/components/RequirePosthogConnection';
import { TimeRangeSelector } from '#features/analytics/components/posthog/TimeRangeSelector';
import { KpiSectionWithTrend } from '#features/analytics/components/posthog/KpiSectionWithTrend';
import { BreakdownPanel } from '#features/analytics/components/posthog/BreakdownPanel';

export function TrafficPage() {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
      <TableHeader title="Traffic" showSearch={false} rightActions={<TimeRangeSelector />} />
      <div className="min-h-0 flex-1">
        <RequirePosthogConnection>
          <div className="h-full overflow-y-auto">
            <div className="mx-auto flex w-4/5 max-w-[1024px] flex-col gap-6 pb-10 pt-10">
              <KpiSectionWithTrend enabled />

              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <BreakdownPanel breakdown="Page" enabled />
                <BreakdownPanel breakdown="Country" enabled />
                <BreakdownPanel breakdown="DeviceType" enabled />
              </div>
            </div>
          </div>
        </RequirePosthogConnection>
      </div>
    </div>
  );
}
