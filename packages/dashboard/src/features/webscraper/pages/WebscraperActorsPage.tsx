import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ExternalLink } from 'lucide-react';
import {
  DataGrid,
  type DataGridColumn,
  type RenderCellProps,
  ErrorState,
  TableHeader,
} from '#components';
import { cn } from '@insforge/ui';
import { useApifyActors } from '#features/webscraper/hooks/useWebscraper';
import { useClientPagination } from '#features/webscraper/hooks/useClientPagination';
import type { ApifyActor } from '#features/webscraper/services/webscraper.service';
import { useWebscraperContext } from '#features/webscraper/components/WebscraperLayout';
import { APIFY_CONSOLE_URL, fmtTime } from '#features/webscraper/components/shared';

type ActorRow = ApifyActor & {
  [key: string]: string | number | boolean | null;
};

const getColumns = (t: TFunction<'chrome'>): DataGridColumn<ActorRow>[] => [
  {
    key: 'actor',
    name: t('webscraper.actor', { defaultValue: 'Actor' }),
    width: '1.6fr',
    minWidth: 200,
    sortable: false,
    renderCell: ({ row }: RenderCellProps<ActorRow>) => {
      const label =
        row.name ?? row.title ?? t('webscraper.unknownActor', { defaultValue: 'Unknown actor' });
      return (
        <span className="truncate text-[13px] leading-[18px] text-foreground" title={label}>
          {label}
        </span>
      );
    },
  },
  {
    key: 'lastRunStartedAt',
    name: t('webscraper.lastRun', { defaultValue: 'Last run' }),
    width: '1.2fr',
    minWidth: 160,
    sortable: false,
    renderCell: ({ row }: RenderCellProps<ActorRow>) => (
      <span className="truncate text-[13px] leading-[18px] tabular-nums text-foreground">
        {fmtTime(row.lastRunStartedAt)}
      </span>
    ),
  },
  {
    key: 'totalRuns',
    name: t('webscraper.runs', { defaultValue: 'Runs' }),
    width: '0.6fr',
    minWidth: 80,
    sortable: false,
    renderCell: ({ row }: RenderCellProps<ActorRow>) => (
      <span className="truncate text-[13px] leading-[18px] tabular-nums text-foreground">
        {row.totalRuns ?? '—'}
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
    renderCell: ({ row }: RenderCellProps<ActorRow>) => (
      <a
        href={`${APIFY_CONSOLE_URL}/actors/${row.id}`}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="text-muted-foreground hover:text-foreground"
        aria-label={t('webscraper.openInApify', { defaultValue: 'Open in Apify' })}
        title={t('webscraper.openInApify', { defaultValue: 'Open in Apify' })}
      >
        <ExternalLink className="size-4" aria-hidden />
      </a>
    ),
  },
];

export function WebscraperActorsPage() {
  const { t } = useTranslation('chrome');
  const { connection } = useWebscraperContext();
  const isActive = connection.status === 'active';
  const actors = useApifyActors(isActive);
  const [search, setSearch] = useState('');
  const columns = useMemo(() => getColumns(t), [t]);

  const rows = useMemo<ActorRow[]>(() => {
    const all = (actors.data ?? []) as ActorRow[];
    const q = search.trim().toLowerCase();
    if (!q) {
      return all;
    }
    return all.filter((a) => `${a.name ?? ''} ${a.title ?? ''}`.toLowerCase().includes(q));
  }, [actors.data, search]);

  const { pageRows, setCurrentPage, gridProps } = useClientPagination(rows, 'webscraper-actors');
  useEffect(() => setCurrentPage(1), [search, setCurrentPage]);

  const errorMessage =
    actors.error instanceof Error && actors.error.message
      ? actors.error.message
      : t('webscraper.loadActorsError', {
          defaultValue: 'Could not load actors from Apify. Try refreshing.',
        });

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
      <TableHeader
        title={t('webscraper.actors', { defaultValue: 'Actors' })}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t('webscraper.searchActors', { defaultValue: 'Search actors' })}
      />
      <div className="relative min-h-0 flex-1">
        {!isActive ? (
          <EmptyMessage
            message={t('webscraper.reconnectToLoadActors', {
              defaultValue: 'Reconnect to load actors.',
            })}
          />
        ) : actors.isError ? (
          <div className="flex h-full items-center justify-center px-6">
            <div className="w-full max-w-[420px]">
              <ErrorState
                title={t('webscraper.loadActorsFailed', {
                  defaultValue: 'Failed to load actors',
                })}
                error={errorMessage}
              />
            </div>
          </div>
        ) : (
          <DataGrid<ActorRow>
            data={pageRows}
            columns={columns}
            loading={actors.isLoading}
            showSelection={false}
            showPagination={true}
            paginationRecordLabel={t('webscraper.recordActors', { defaultValue: 'actors' })}
            showTypeBadge={false}
            emptyState={
              <EmptyMessage
                message={t('webscraper.noActorsYet', { defaultValue: 'No actors yet.' })}
              />
            }
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
