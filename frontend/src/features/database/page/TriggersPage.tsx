import { useMemo, useState, useEffect } from 'react';
import RefreshIcon from '@/assets/icons/refresh.svg?react';
import {
  Button,
  ConvertedValue,
  DataGrid,
  type DataGridColumn,
  type DataGridRowType,
  EmptyState,
  SearchInput,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components';
import { useFullMetadata } from '../hooks/useFullMetadata';
import { SQLModal, SQLCellButton } from '../components/SQLModal';
import type {
  ExportDatabaseResponse,
  ExportDatabaseJsonData,
  SocketMessage,
} from '@insforge/shared-schemas';
import { isSystemTable } from '../constants';
import { DataUpdateResourceType, ServerEvents, useSocket } from '@/lib/contexts/SocketContext';

interface TriggerRow extends DataGridRowType {
  id: string;
  tableName: string;
  triggerName: string;
  actionTiming: string;
  eventManipulation: string;
  actionStatement: string;
  [key: string]: ConvertedValue | { [key: string]: string }[];
}

function parseTriggersFromMetadata(metadata: ExportDatabaseResponse | undefined): TriggerRow[] {
  if (!metadata || metadata.format !== 'json' || typeof metadata.data === 'string') {
    return [];
  }

  const data = metadata.data as ExportDatabaseJsonData;
  const triggers: TriggerRow[] = [];

  Object.entries(data.tables).forEach(([tableName, tableData]) => {
    if (isSystemTable(tableName)) {
      return;
    }

    tableData.triggers.forEach((trigger) => {
      triggers.push({
        id: `${tableName}_${trigger.triggerName}`,
        tableName,
        triggerName: trigger.triggerName,
        actionTiming: trigger.actionTiming,
        eventManipulation: trigger.eventManipulation,
        actionStatement: trigger.actionStatement,
      });
    });
  });

  return triggers;
}

export default function TriggersPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { data: metadata, isLoading, error, refetch } = useFullMetadata(true);
  const [sqlModal, setSqlModal] = useState({ open: false, title: '', value: '' });

  const { socket, isConnected } = useSocket();

  const allTriggers = useMemo(() => parseTriggersFromMetadata(metadata), [metadata]);

  useEffect(() => {
    if (!socket || !isConnected) {
      return;
    }

    const handleDataUpdate = (message: SocketMessage) => {
      if (message.resource === DataUpdateResourceType.DATABASE) {
        void refetch();
      }
    };

    socket.on(ServerEvents.DATA_UPDATE, handleDataUpdate);

    return () => {
      socket.off(ServerEvents.DATA_UPDATE, handleDataUpdate);
    };
  }, [socket, isConnected, refetch]);

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
      <div className="flex-1 flex items-center justify-center">
        <EmptyState
          title="Failed to load triggers"
          description={error instanceof Error ? error.message : 'An error occurred'}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 h-full p-4 bg-bg-gray dark:bg-neutral-800">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-normal text-zinc-950 dark:text-white">Database Triggers</h1>

        {/* Separator */}
        <div className="h-6 w-px bg-gray-200 dark:bg-neutral-700" />

        {/* Refresh button */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="p-1 h-9 w-9"
                onClick={() => void handleRefresh()}
                disabled={isRefreshing}
              >
                <RefreshIcon className="h-5 w-5 text-zinc-400 dark:text-neutral-400" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="center">
              <p>{isRefreshing ? 'Refreshing...' : 'Refresh'}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <SearchInput
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder="Search for a trigger"
        className="w-64"
      />

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState title="Loading triggers..." description="Please wait" />
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
          <DataGrid
            data={filteredTriggers}
            columns={columns}
            showSelection={false}
            showPagination={false}
            noPadding={true}
            className="h-full"
            isRefreshing={isRefreshing}
            emptyState={
              <div className="text-sm text-zinc-500 dark:text-zinc-400">
                {searchQuery ? 'No triggers match your search criteria' : 'No triggers found'}
              </div>
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
  );
}
