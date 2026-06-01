import { useMemo } from 'react';
import { EmptyState, ErrorState, LoadingState } from '#components';
import { useRetention } from '#features/analytics/hooks/useRetention';
import { formatNumber } from '#features/analytics/lib/format';

interface Cell {
  pct: number | null;
  count: number | null;
}

export function RetentionCard({ enabled }: { enabled: boolean }) {
  const { data, isLoading, error } = useRetention(enabled);

  const grid = useMemo(() => {
    if (!data?.rows) {
      return null;
    }
    return data.rows.map((row) => {
      const base = row.values[0]?.count ?? 0;
      const cells: Cell[] = row.values.map((v) => {
        const count = v.count;
        if (count === null) {
          return { pct: null, count: null };
        }
        const pct = base > 0 ? (count / base) * 100 : 0;
        return { pct, count };
      });
      return {
        date: row.date,
        label: row.label,
        cells,
      };
    });
  }, [data]);

  if (isLoading) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center">
        <LoadingState className="py-0" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center px-6">
        <div className="w-full max-w-[420px]">
          <ErrorState title="Failed to load retention" error="Please try again." />
        </div>
      </div>
    );
  }

  if (!grid || grid.length === 0) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center">
        <EmptyState title="No data available" />
      </div>
    );
  }

  const intervals = grid[0].cells.length;
  const intervalLabels = Array.from({ length: intervals }, (_, i) => `Week ${i}`);

  function formatCohortRange(iso: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    if (!m) {
      return iso;
    }
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const start = new Date(year, month - 1, day);
    if (
      Number.isNaN(start.getTime()) ||
      start.getFullYear() !== year ||
      start.getMonth() !== month - 1 ||
      start.getDate() !== day
    ) {
      return iso;
    }
    const end = new Date(start.getTime() + 6 * 86_400_000);
    const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `${fmt(start)} to ${fmt(end)}`;
  }

  // Figma 3177-54743 cell-level spec:
  // - Row: flex items-center, padding-left 6px, border-bottom 1px alpha-8
  // - Cohort cell: w-[202px] h-8 p-1.5 (first cell, no left border)
  // - Size cell:   w-[161px] h-8 p-1.5 + border-left 1px alpha-8
  // - Week cell:   w-[160px] h-8 p-1.5 + border-left 1px alpha-8
  // - Week inner "context": bg emerald-700/20, rounded, relative
  //   with absolute fill bar of bg-emerald-700 sized to pct%, white centered text
  // - Empty cells (triangular gap): cell with no inner content
  return (
    <div className="overflow-x-auto bg-semantic-1">
      {/* header row */}
      <div className="flex items-center border-b border-[var(--alpha-8)] pl-1.5">
        <div className="flex h-8 w-[202px] items-center p-1.5">
          <span className="px-1 text-[13px] leading-[18px] text-muted-foreground">Cohort</span>
        </div>
        <div className="flex h-8 w-[161px] items-center border-l border-[var(--alpha-8)] p-1.5">
          <span className="px-1 text-[13px] leading-[18px] text-muted-foreground">Size</span>
        </div>
        {intervalLabels.map((lbl) => (
          <div
            key={lbl}
            className="flex h-8 w-[160px] items-center justify-center border-l border-[var(--alpha-8)] p-1.5"
          >
            <span className="text-[13px] leading-[18px] text-muted-foreground">{lbl}</span>
          </div>
        ))}
      </div>

      {/* data rows */}
      {grid.map((row) => {
        const size = row.cells[0]?.count ?? 0;
        return (
          <div key={row.date} className="flex items-center border-b border-[var(--alpha-8)] pl-1.5">
            <div className="flex h-8 w-[202px] items-center p-1.5">
              <span className="whitespace-nowrap px-1 text-[13px] leading-[18px] text-foreground">
                {formatCohortRange(row.date)}
              </span>
            </div>
            <div className="flex h-8 w-[161px] items-center border-l border-[var(--alpha-8)] p-1.5">
              <span className="px-1 text-[13px] leading-[18px] text-foreground">
                {formatNumber(size)}
              </span>
            </div>
            {row.cells.map((cell, i) => (
              <div
                key={i}
                title={
                  cell.count === null
                    ? '—'
                    : `${formatNumber(cell.count)} users (${(cell.pct ?? 0).toFixed(1)}%)`
                }
                className="flex h-8 w-[160px] items-center border-l border-[var(--alpha-8)] p-1.5"
              >
                {cell.pct === null ? null : (
                  <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded bg-emerald-700/20">
                    <div
                      className="absolute inset-y-0 left-0 bg-emerald-700"
                      style={{ width: `${Math.min(100, Math.max(0, cell.pct))}%` }}
                    />
                    <span className="relative text-[13px] leading-[18px] text-foreground">
                      {cell.pct.toFixed(1)}%
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
