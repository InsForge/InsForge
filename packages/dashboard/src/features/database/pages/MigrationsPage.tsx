import { useMemo, useState } from 'react';
import RefreshIcon from '#assets/icons/refresh.svg?react';
import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@insforge/ui';
import { useNavigate } from 'react-router-dom';
import {
  DataGrid,
  DataGridEmptyState,
  EmptyState,
  TableHeader,
  type DataGridColumn,
  type DataGridRowType,
} from '#components';
import { formatTime } from '#lib/utils/utils';
import type { DatabaseMigrationsResponse } from '@insforge/shared-schemas';
import { DatabaseStudioSidebarPanel } from '#features/database/components/DatabaseSidebar';
import { SQLCellButton, SQLModal } from '#features/database/components/SQLModal';
import { useMigrations } from '#features/database/hooks/useMigrations';

interface MigrationRow extends DataGridRowType {
  id: string;
  version: string;
  name: string;
  statements: string;
  createdAt: string;
}

function formatMigrationStatements(statements: string[]): string {
  return statements
    .map((statement) => statement.trim().replace(/;+\s*$/u, ''))
    .filter(Boolean)
    .map((statement) => `${statement};`)
    .join('\n\n');
}

function parseMigrationsFromResponse(
  response: DatabaseMigrationsResponse | undefined
): MigrationRow[] {
  if (!response?.migrations) {
    return [];
  }

  return response.migrations.map((migration) => ({
    id: migration.version,
    version: migration.version,
    name: migration.name,
    statements: formatMigrationStatements(migration.statements),
    createdAt: migration.createdAt,
  }));
}

export default function MigrationsPage() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [sqlModal, setSqlModal] = useState({ open: false, title: '', value: '' });
  const { data, isLoading, error, refetch } = useMigrations(true);

  const allMigrations = useMemo(() => parseMigrationsFromResponse(data), [data]);

  const filteredMigrations = useMemo(() => {
    if (!searchQuery.trim()) {
      return allMigrations;
    }

    const query = searchQuery.toLowerCase();
    return allMigrations.filter(
      (migration) =>
        migration.name.toLowerCase().includes(query) || migration.version.includes(query)
    );
  }, [allMigrations, searchQuery]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      setSearchQuery('');
      await refetch();
    } finally {
      setIsRefreshing(false);
    }
  };

  const columns: DataGridColumn<MigrationRow>[] = useMemo(
    () => [
      {
        key: 'version',
        name: 'Version',
        width: 'minmax(180px, 1.2fr)',
        resizable: true,
        sortable: true,
      },
      {
        key: 'name',
        name: 'Name',
        width: 'minmax(220px, 2fr)',
        resizable: true,
        sortable: true,
      },
      {
        key: 'statements',
        name: 'Statements',
        width: 'minmax(320px, 4fr)',
        resizable: true,
        renderCell: ({ row }) => (
          <SQLCellButton
            value={row.statements}
            onClick={() =>
              setSqlModal({
                open: true,
                title: `${row.name}`,
                value: row.statements,
              })
            }
          />
        ),
      },
      {
        key: 'createdAt',
        name: 'Created At',
        width: 'minmax(220px, 1.8fr)',
        resizable: true,
        sortable: true,
        renderCell: ({ row }) => formatTime(row.createdAt),
      },
    ],
    []
  );

  if (error) {
    return (
      <div className="flex h-full min-h-0 overflow-hidden bg-[rgb(var(--semantic-1))]">
        <DatabaseStudioSidebarPanel
          onBack={() =>
            void navigate('/dashboard/database/tables', { state: { slideFromStudio: true } })
          }
        />
        <div className="min-w-0 flex-1 flex items-center justify-center bg-[rgb(var(--semantic-1))]">
          <EmptyState
            title="Failed to load migrations"
            description={error instanceof Error ? error.message : 'An error occurred'}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-[rgb(var(--semantic-1))]">
      <DatabaseStudioSidebarPanel
        onBack={() =>
          void navigate('/dashboard/database/tables', { state: { slideFromStudio: true } })
        }
      />
      <div className="min-w-0 flex-1 flex flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
        <TableHeader
          title="Database Migrations"
          showDividerAfterTitle
          titleButtons={
            <div className="flex items-center gap-2">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded p-1.5 text-muted-foreground hover:bg-[var(--alpha-4)] active:bg-[var(--alpha-8)]"
                      onClick={() => void handleRefresh()}
                      disabled={isRefreshing}
                      aria-label={isRefreshing ? 'Refreshing migrations' : 'Refresh migrations'}
                    >
                      <RefreshIcon className={isRefreshing ? 'h-5 w-5 animate-spin' : 'h-5 w-5'} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" align="center">
                    <p>{isRefreshing ? 'Refreshing...' : 'Refresh migrations'}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          }
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search migration"
        />

        {isLoading ? (
          <div className="min-h-0 flex-1 flex items-center justify-center">
            <EmptyState title="Loading migrations..." description="Please wait" />
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-hidden">
            <DataGrid
              data={filteredMigrations}
              columns={columns}
              showSelection={false}
              showPagination={false}
              noPadding={true}
              className="h-full"
              isRefreshing={isRefreshing}
              emptyState={
                <DataGridEmptyState
                  message={
                    searchQuery
                      ? 'No migrations match your search criteria'
                      : 'No migrations have been executed yet'
                  }
                />
              }
            />
          </div>
        )}

        <SQLModal
          open={sqlModal.open}
          onOpenChange={(open) => setSqlModal((prev) => ({ ...prev, open }))}
          title={sqlModal.title}
          value={sqlModal.value}
        />
      </div>
    </div>
  );
}
