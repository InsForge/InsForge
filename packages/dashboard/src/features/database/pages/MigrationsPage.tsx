import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import RefreshIcon from '../../../assets/icons/refresh.svg?react';
import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@insforge/ui';
import { useNavigate } from 'react-router-dom';
import {
  DataGrid,
  DataGridEmptyState,
  EmptyState,
  TableHeader,
  type DataGridColumn,
  type DataGridRowType,
} from '../../../components';
import { formatTime } from '../../../lib/utils/utils';
import type { DatabaseMigrationsResponse } from '@insforge/shared-schemas';
import { DatabaseStudioSidebarPanel } from '../components/DatabaseSidebar';
import { MigrationFormDialog } from '../components/MigrationFormDialog';
import { SQLCellButton, SQLModal } from '../components/SQLModal';
import { useMigrations } from '../hooks/useMigrations';

interface MigrationRow extends DataGridRowType {
  id: string;
  sequenceNumber: number;
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
    id: String(migration.sequenceNumber),
    sequenceNumber: migration.sequenceNumber,
    name: migration.name,
    statements: formatMigrationStatements(migration.statements),
    createdAt: migration.createdAt,
  }));
}

export default function MigrationsPage() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [sqlModal, setSqlModal] = useState({ open: false, title: '', value: '' });
  const { data, isLoading, error, refetch, createMigration, isCreating } = useMigrations(true);

  const allMigrations = useMemo(() => parseMigrationsFromResponse(data), [data]);

  const filteredMigrations = useMemo(() => {
    if (!searchQuery.trim()) {
      return allMigrations;
    }

    const query = searchQuery.toLowerCase();
    return allMigrations.filter(
      (migration) =>
        migration.name.toLowerCase().includes(query) ||
        String(migration.sequenceNumber).includes(query)
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

  const handleCreateMigration = async (payload: { name: string; sql: string }) => {
    await createMigration(payload);
    setIsDialogOpen(false);
  };

  const columns: DataGridColumn<MigrationRow>[] = useMemo(
    () => [
      {
        key: 'sequenceNumber',
        name: '#',
        width: 'minmax(96px, 0.8fr)',
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
                title: `${row.name} Statements`,
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
              <Button
                type="button"
                className="h-8 gap-1.5 px-2"
                onClick={() => setIsDialogOpen(true)}
              >
                <Plus className="h-4 w-4" />
                Run Migration
              </Button>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded p-1.5 text-muted-foreground hover:bg-[var(--alpha-4)] active:bg-[var(--alpha-8)]"
                      onClick={() => void handleRefresh()}
                      disabled={isRefreshing}
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

        <MigrationFormDialog
          open={isDialogOpen}
          onOpenChange={setIsDialogOpen}
          onSubmit={handleCreateMigration}
          isSubmitting={isCreating}
        />

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
