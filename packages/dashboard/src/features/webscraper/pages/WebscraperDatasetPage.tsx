import { useEffect, useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import {
  DataGrid,
  type DataGridColumn,
  type RenderCellProps,
  ErrorState,
  TableHeader,
} from '#components';
import { cn } from '@insforge/ui';
import { useApifyActors, useApifyDatasets } from '#features/webscraper/hooks/useWebscraper';
import { useClientPagination } from '#features/webscraper/hooks/useClientPagination';
import type { ApifyDataset } from '#features/webscraper/services/webscraper.service';
import { useWebscraperContext } from '#features/webscraper/components/WebscraperLayout';
import { APIFY_CONSOLE_URL, fmtTime } from '#features/webscraper/components/shared';

type DatasetRow = ApifyDataset & {
  actorName: string;
  [key: string]: string | number | boolean | null;
};

const columns: DataGridColumn<DatasetRow>[] = [
  {
    key: 'dataset',
    name: 'Dataset',
    width: '1.6fr',
    minWidth: 200,
    sortable: false,
    renderCell: ({ row }: RenderCellProps<DatasetRow>) => {
      const label = row.name ?? row.id;
      return (
        <span className="truncate text-[13px] leading-[18px] text-foreground" title={row.id}>
          {label}
        </span>
      );
    },
  },
  {
    key: 'itemCount',
    name: 'Items',
    width: '0.6fr',
    minWidth: 80,
    sortable: false,
    renderCell: ({ row }: RenderCellProps<DatasetRow>) => (
      <span className="truncate text-[13px] leading-[18px] tabular-nums text-foreground">
        {row.itemCount ?? '—'}
      </span>
    ),
  },
  {
    key: 'createdAt',
    name: 'Created',
    width: '1.2fr',
    minWidth: 160,
    sortable: false,
    renderCell: ({ row }: RenderCellProps<DatasetRow>) => (
      <span className="truncate text-[13px] leading-[18px] tabular-nums text-foreground">
        {fmtTime(row.createdAt)}
      </span>
    ),
  },
  {
    key: 'actor',
    name: 'Actor',
    width: '1.2fr',
    minWidth: 160,
    sortable: false,
    renderCell: ({ row }: RenderCellProps<DatasetRow>) => (
      <span className="truncate text-[13px] leading-[18px] text-foreground" title={row.actorName}>
        {row.actorName}
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
    renderCell: ({ row }: RenderCellProps<DatasetRow>) => (
      <a
        href={`${APIFY_CONSOLE_URL}/storage/datasets/${row.id}`}
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

export function WebscraperDatasetPage() {
  const { connection } = useWebscraperContext();
  const isActive = connection.status === 'active';
  const datasets = useApifyDatasets(isActive);
  // Join dataset.actId against the actor list for the originating actor's name.
  const actors = useApifyActors(isActive);
  const [search, setSearch] = useState('');

  const rows = useMemo<DatasetRow[]>(() => {
    const actorNameById = new Map(
      (actors.data ?? []).map((a) => [a.id, a.name ?? a.title ?? a.id])
    );
    const all = (datasets.data ?? []).map((d) => ({
      ...d,
      actorName: d.actId ? (actorNameById.get(d.actId) ?? d.actId) : 'Unknown actor',
    })) as DatasetRow[];
    const q = search.trim().toLowerCase();
    if (!q) {
      return all;
    }
    return all.filter((d) => `${d.name ?? ''} ${d.id} ${d.actorName}`.toLowerCase().includes(q));
  }, [datasets.data, actors.data, search]);

  const { pageRows, setCurrentPage, gridProps } = useClientPagination(rows, 'webscraper-datasets');
  useEffect(() => setCurrentPage(1), [search, setCurrentPage]);

  const errorMessage =
    datasets.error instanceof Error && datasets.error.message
      ? datasets.error.message
      : 'Could not load datasets from Apify. Try refreshing.';

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
      <TableHeader
        title="Dataset"
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search datasets"
      />
      <div className="relative min-h-0 flex-1">
        {!isActive ? (
          <EmptyMessage message="Reconnect to load datasets." />
        ) : datasets.isError ? (
          <div className="flex h-full items-center justify-center px-6">
            <div className="w-full max-w-[420px]">
              <ErrorState title="Failed to load datasets" error={errorMessage} />
            </div>
          </div>
        ) : (
          <DataGrid<DatasetRow>
            data={pageRows}
            columns={columns}
            loading={datasets.isLoading}
            showSelection={false}
            showPagination={true}
            paginationRecordLabel="datasets"
            showTypeBadge={false}
            emptyState={<EmptyMessage message="No datasets yet." />}
            {...gridProps}
          />
        )}
      </div>
    </div>
  );
}

function EmptyMessage({ message }: { message: string }) {
  return (
    <div className={cn('flex h-full items-center justify-center')}>
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
