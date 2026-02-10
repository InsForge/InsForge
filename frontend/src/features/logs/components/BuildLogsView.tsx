import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { logService, type GetBuildLogsResponse, type BuildLogEntry } from '../services/log.service';
import { LogsDataGrid, type LogsColumnDef } from './LogsDataGrid';
import { cn } from '@/lib/utils/utils';

interface BuildLogsViewProps {
  className?: string;
}

function getLevelColor(level: string): string {
  switch (level.toLowerCase()) {
    case 'error':
      return 'text-red-500';
    case 'warning':
    case 'warn':
      return 'text-yellow-500';
    case 'info':
      return 'text-blue-400';
    case 'debug':
      return 'text-gray-400';
    default:
      return 'text-gray-500 dark:text-gray-300';
  }
}

function getStatusBadge(status: GetBuildLogsResponse['status']) {
  const statusConfig = {
    pending: { label: 'Building', bgColor: 'bg-yellow-500/20', textColor: 'text-yellow-500' },
    success: { label: 'Success', bgColor: 'bg-green-500/20', textColor: 'text-green-500' },
    failed: { label: 'Failed', bgColor: 'bg-red-500/20', textColor: 'text-red-500' },
  };

  const config = statusConfig[status] || statusConfig.pending;

  return (
    <span
      className={cn('px-2 py-0.5 text-xs font-medium rounded', config.bgColor, config.textColor)}
    >
      {config.label}
    </span>
  );
}

// Transform build logs to have unique IDs for DataGrid
interface BuildLogRow extends BuildLogEntry {
  id: string;
}

export function BuildLogsView({ className }: BuildLogsViewProps) {
  const { data: buildLogs, isLoading } = useQuery<GetBuildLogsResponse | null>({
    queryKey: ['function-build-logs'],
    queryFn: () => logService.getFunctionBuildLogs(),
    staleTime: 30 * 1000,
    // Don't retry on 404 - it's expected when no deployments exist
    retry: false,
    refetchInterval: (query) => {
      const data = query.state.data;
      // Refetch every 5 seconds if build is pending
      return data?.status === 'pending' ? 5000 : false;
    },
  });

  // Transform logs to add IDs
  const logsWithIds: BuildLogRow[] = useMemo(() => {
    if (!buildLogs?.logs) {
      return [];
    }
    return buildLogs.logs.map((log, index) => ({
      ...log,
      id: `build-log-${index}`,
    }));
  }, [buildLogs?.logs]);

  // Column definitions for build logs
  const columns: LogsColumnDef[] = useMemo(
    () => [
      {
        key: 'level',
        name: 'Level',
        width: '100px',
        renderCell: ({ row }) => {
          const level = (row as unknown as BuildLogRow).level;
          return <span className={cn('text-sm font-medium', getLevelColor(level))}>{level}</span>;
        },
      },
      {
        key: 'message',
        name: 'Message',
        width: '1fr',
        renderCell: ({ row }) => {
          const message = (row as unknown as BuildLogRow).message;
          return (
            <p className="text-sm text-gray-900 dark:text-white font-normal leading-6 truncate">
              {message}
            </p>
          );
        },
      },
    ],
    []
  );

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Build info header - only show when we have build data */}
      {buildLogs && (
        <div className="px-4 py-3 border-b border-gray-200 dark:border-neutral-700 flex items-center gap-4 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 dark:text-gray-400">Deployment:</span>
            <code className="text-sm font-mono text-gray-900 dark:text-white">
              {buildLogs.deploymentId}
            </code>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 dark:text-gray-400">Status:</span>
            {getStatusBadge(buildLogs.status)}
          </div>
        </div>
      )}

      {/* Build logs table */}
      <div className="flex-1 overflow-hidden">
        <LogsDataGrid
          columnDefs={columns}
          data={logsWithIds}
          loading={isLoading}
          currentPage={1}
          totalPages={1}
          pageSize={logsWithIds.length || 50}
          totalRecords={logsWithIds.length}
          onPageChange={() => {}}
          emptyState={
            <div className="text-sm text-zinc-500 dark:text-zinc-400">No build logs found</div>
          }
        />
      </div>
    </div>
  );
}
