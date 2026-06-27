import { useEffect, useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import {
  DataGrid,
  type DataGridColumn,
  type RenderCellProps,
  ErrorState,
  TableHeader,
} from '#components';
import { useApifyActors, useApifyRuns } from '#features/webscraper/hooks/useWebscraper';
import { useClientPagination } from '#features/webscraper/hooks/useClientPagination';
import type { ApifyRun } from '#features/webscraper/services/webscraper.service';
import { useWebscraperContext } from '#features/webscraper/components/WebscraperLayout';
import {
  APIFY_CONSOLE_URL,
  RunStatusBadge,
  fmtCost,
  fmtTime,
} from '#features/webscraper/components/shared';

type RunRow = ApifyRun & {
  actorName: string;
  [key: string]: string | number | boolean | null;
};

const columns: DataGridColumn<RunRow>[] = [
  {
    key: 'actorName',
    name: 'Actor',
    width: '1.6fr',
    minWidth: 200,
    sortable: false,
    renderCell: ({ row }: RenderCellProps<RunRow>) => (
      <span className="truncate text-[13px] leading-[18px] text-foreground" title={row.actorName}>
        {row.actorName}
      </span>
    ),
  },
  {
    key: 'status',
    name: 'Status',
    width: '0.8fr',
    minWidth: 120,
    sortable: false,
    renderCell: ({ row }: RenderCellProps<RunRow>) => <RunStatusBadge status={row.status} />,
  },
  {
    key: 'startedAt',
    name: 'Started',
    width: '1.2fr',
    minWidth: 160,
    sortable: false,
    renderCell: ({ row }: RenderCellProps<RunRow>) => (
      <span className="truncate text-[13px] leading-[18px] tabular-nums text-foreground">
        {fmtTime(row.startedAt)}
      </span>
    ),
  },
  {
    key: 'usageTotalUsd',
    name: 'Cost',
    width: '0.6fr',
    minWidth: 90,
    sortable: false,
    renderCell: ({ row }: RenderCellProps<RunRow>) => (
      <span className="truncate text-[13px] leading-[18px] tabular-nums text-foreground">
        {fmtCost(row.usageTotalUsd)}
      </span>
    ),
  },
  {
    key: 'open',
    name: '',
    width: '0.3fr',
    minWidth: 44,
    sortable: false,
    resizable: false,
    renderCell: ({ row }: RenderCellProps<RunRow>) => (
      <a
        href={`${APIFY_CONSOLE_URL}/actors/runs/${row.id}`}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="text-muted-foreground hover:text-foreground"
        aria-label="Open in Apify"
        title="Open in Apify"
      >
        <ExternalLink className="size-4" aria-hidden />
      </a>
    ),
  },
];

export function WebscraperRunsPage() {
  const { connection } = useWebscraperContext();
  const isActive = connection.status === 'active';
  const runs = useApifyRuns(isActive);
  const actors = useApifyActors(isActive);
  const [search, setSearch] = useState('');

  const nameByActId = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of actors.data ?? []) {
      const n = a.name ?? a.title;
      if (n) {
        m.set(a.id, n);
      }
    }
    return m;
  }, [actors.data]);

  const rows = useMemo<RunRow[]>(() => {
    const all = (runs.data ?? []).map((r) => ({
      ...r,
      actorName: (r.actId && nameByActId.get(r.actId)) || r.actId || 'Unknown actor',
    }));
    const q = search.trim().toLowerCase();
    if (!q) {
      return all;
    }
    return all.filter((r) => `${r.actorName} ${r.status ?? ''}`.toLowerCase().includes(q));
  }, [runs.data, nameByActId, search]);

  const { pageRows, setCurrentPage, gridProps } = useClientPagination(rows, 'webscraper-runs');
  // A new search starts from page 1 (clamping alone would keep stale state).
  useEffect(() => setCurrentPage(1), [search, setCurrentPage]);

  const errorMessage =
    runs.error instanceof Error && runs.error.message
      ? runs.error.message
      : 'Could not load runs from Apify. Try refreshing.';

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
      <TableHeader
        title="Runs"
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search runs"
      />
      <div className="relative min-h-0 flex-1">
        {!isActive ? (
          <EmptyMessage message="Reconnect to load runs." />
        ) : runs.isError ? (
          <div className="flex h-full items-center justify-center px-6">
            <div className="w-full max-w-[420px]">
              <ErrorState title="Failed to load runs" error={errorMessage} />
            </div>
          </div>
        ) : (
          <DataGrid<RunRow>
            data={pageRows}
            columns={columns}
            loading={runs.isLoading}
            showSelection={false}
            showPagination={true}
            paginationRecordLabel="runs"
            showTypeBadge={false}
            emptyState={<EmptyMessage message="No runs yet." />}
            {...gridProps}
          />
        )}
      </div>
    </div>
  );
}

function EmptyMessage({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
