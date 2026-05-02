import { useMemo, useState } from 'react';
import RefreshIcon from '#assets/icons/refresh.svg?react';
import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@insforge/ui';
import { useNavigate } from 'react-router-dom';
import {
  ConvertedValue,
  DataGridEmptyState,
  DataGrid,
  type DataGridColumn,
  type DataGridRowType,
  EmptyState,
  TableHeader,
} from '#components';
import { useTriggers } from '#features/database/hooks/useDatabase';
import { SQLModal, SQLCellButton } from '#features/database/components/SQLModal';
import { DatabaseStudioSidebarPanel } from '#features/database/components/DatabaseSidebar';
import type { DatabaseTriggersResponse } from '@insforge/shared-schemas';

interface TriggerRow extends DataGridRowType {
  id: string;
  tableName: string;
  triggerName: string;
  actionTiming: string;
  eventManipulation: string;
  actionStatement: string;
  [key: string]: ConvertedValue | { [key: string]: string }[];
}

function parseTriggersFromResponse(response: DatabaseTriggersResponse | undefined): TriggerRow[] {
  if (!response?.triggers) {
    return [];
  }

  const triggers: TriggerRow[] = [];

  response.triggers.forEach((trigger) => {
    triggers.push({
      id: `${trigger.tableName}_${trigger.triggerName}`,
      tableName: trigger.tableName,
      triggerName: trigger.triggerName,
      actionTiming: trigger.actionTiming,
      eventManipulation: trigger.eventManipulation,
      actionStatement: trigger.actionStatement,
    });
  });

  return triggers;
}

export default function TriggersPage() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { data, isLoading, error, refetch } = useTriggers(true);
  const [sqlModal, setSqlModal] = useState({ open: false, title: '', value: '' });

  const allTriggers = useMemo(() => parseTriggersFromResponse(data), [data]);

  const filteredTriggers = useMemo(() => {
    if (!searchQuery.trim()) {
      return allTriggers;
    }

    const query = searchQuery.toLowerCase();
    return allTriggers.filter(
      (trigger) =>
        trigger.triggerName.toLowerCase().includes(query) ||
        trigger.tableName.toLowerCase().includes(query)
    );
  }, [allTriggers, searchQuery]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      setSearchQuery('');
      await refetch();
    } finally {
      setIsRefreshing(false);
    }
  };

  const columns: DataGridColumn<TriggerRow>[] = useMemo(
    () => [
      {
        key: 'tableName',
        name: 'Table',
        width: 'minmax(180px, 1.5fr)',
        resizable: true,
        sortable: true,
      },
      {
        key: 'triggerName',
        name: 'Name',
        width: 'minmax(200px, 2fr)',
        resizable: true,
        sortable: true,
      },
      {
        key: 'actionTiming',
        name: 'Timing',
        width: 'minmax(100px, 1fr)',
        resizable: true,
        sortable: true,
        renderCell: ({ row }) => {
          const timing = row.actionTiming.toUpperCase();
          return (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300">
              {timing}
            </span>
          );
        },
      },
      {
        key: 'eventManipulation',
        name: 'Event',
        width: 'minmax(100px, 1fr)',
        resizable: true,
        sortable: true,
        renderCell: ({ row }) => {
          const event = row.eventManipulation.toUpperCase();
          return (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300">
              {event}
            </span>
          );
        },
      },
      {
        key: 'actionStatement',
        name: 'Statement',
        width: 'minmax(300px, 3fr)',
        resizable: true,
        renderCell: ({ row }) => (
          <SQLCellButton
            value={row.actionStatement}
            onClick={() =>
              setSqlModal({ open: true, title: 'Trigger Statement', value: row.actionStatement })
            }
          />
        ),
      },
    ],
    [setSqlModal]
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
            title="Failed to load triggers"
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
          title="Database Triggers"
          showDividerAfterTitle
          titleButtons={
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
                  <p>{isRefreshing ? 'Refreshing...' : 'Refresh triggers'}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          }
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search trigger"
        />
        {isLoading ? (
          <div className="min-h-0 flex-1 flex items-center justify-center">
            <EmptyState title="Loading triggers..." description="Please wait" />
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-hidden">
            <DataGrid
              data={filteredTriggers}
              columns={columns}
              showSelection={false}
              showPagination={false}
              noPadding={true}
              className="h-full"
              isRefreshing={isRefreshing}
              emptyState={
                <DataGridEmptyState
                  message={
                    searchQuery ? 'No triggers match your search criteria' : 'No triggers found'
                  }
                />
              }
            />
          </div>
        )}

        {/* SQL Detail Modal */}
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
