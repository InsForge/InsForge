import { useMemo } from 'react';
import { useRetention } from '../../hooks/useRetention';
import { formatNumber } from '../../lib/format';

interface Cell {
  pct: number | null;
  count: number | null;
}

function cellBackground(pct: number | null): string {
  if (pct === null) {
    return 'transparent';
  }
  // Map [0, 100] to alpha [0.05, 0.6]
  const alpha = 0.05 + (Math.min(100, Math.max(0, pct)) / 100) * 0.55;
  return `rgb(var(--primary) / ${alpha.toFixed(3)})`;
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
      <div className="rounded-lg bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold text-foreground">Retention</h3>
        <div className="text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-destructive/10 p-4">
        <h3 className="mb-3 text-sm font-semibold text-destructive">Retention</h3>
        <div className="text-sm text-destructive">Failed to load retention.</div>
      </div>
    );
  }

  if (!grid || grid.length === 0) {
    return (
      <div className="rounded-lg bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold text-foreground">Retention</h3>
        <div className="text-sm text-muted-foreground">No data</div>
      </div>
    );
  }

  const intervals = grid[0].cells.length;
  // Always weekly to match PostHog's default Web Analytics retention view.
  const intervalLabels = Array.from({ length: intervals }, (_, i) => `Week ${i}`);

  function formatCohortRange(iso: string): string {
    const start = new Date(iso);
    if (Number.isNaN(start.getTime())) {
      return iso;
    }
    const end = new Date(start.getTime() + 6 * 86_400_000);
    const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `${fmt(start)} to ${fmt(end)}`;
  }

  return (
    <div className="rounded-lg bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">User retention</h3>
        <span className="text-xs text-muted-foreground">Weekly cohort · {intervals} weeks</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Cohort</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground">Size</th>
              {intervalLabels.map((lbl) => (
                <th key={lbl} className="px-2 py-2 text-center font-medium text-muted-foreground">
                  {lbl}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map((row) => {
              const size = row.cells[0]?.count ?? 0;
              return (
                <tr key={row.date}>
                  <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                    {formatCohortRange(row.date)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right text-muted-foreground">
                    {formatNumber(size)}
                  </td>
                  {row.cells.map((cell, i) => (
                    <td
                      key={i}
                      className="px-1 py-0.5 text-center"
                      title={
                        cell.count === null
                          ? '—'
                          : `${formatNumber(cell.count)} users (${(cell.pct ?? 0).toFixed(1)}%)`
                      }
                    >
                      {cell.pct === null ? (
                        <div className="px-1 py-1 text-muted-foreground">—</div>
                      ) : (
                        <div
                          className="rounded px-1 py-1 text-foreground"
                          style={{ backgroundColor: cellBackground(cell.pct) }}
                        >
                          {(cell.pct ?? 0).toFixed(1)}%
                        </div>
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
