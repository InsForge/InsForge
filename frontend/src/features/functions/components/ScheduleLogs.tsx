import { useState, useMemo } from 'react';
import { LogsDataGrid, LogsColumnDef } from '@/features/logs/components/LogsDataGrid';
import { useScheduleLogs } from '@/features/functions/hooks/useSchedules';
import { format } from 'date-fns';

const PAGE_SIZE = 50;

interface ScheduleLogsProps {
  scheduleId: string;
}

export function ScheduleLogs({ scheduleId }: ScheduleLogsProps) {
  const [currentPage] = useState(1);
  const offset = (currentPage - 1) * PAGE_SIZE;

  const { data, isLoading, error } = useScheduleLogs(scheduleId, PAGE_SIZE, offset);
  const logs = data?.logs || [];

  const columns = useMemo((): LogsColumnDef[] => {
    const defs: LogsColumnDef[] = [
      {
        key: 'id',
        name: 'Run ID',
        width: 'minmax(120px, 2fr)',
        renderCell: ({ row }) => (
          <p className="text-sm text-gray-900 dark:text-white font-mono leading-6 truncate">
            {String(row.id ?? '')}
          </p>
        ),
      },
      {
        key: 'executedAt',
        name: 'Start Time',
        width: 'minmax(140px, 1.5fr)',
        renderCell: ({ row }) => (
          <p className="text-sm text-gray-900 dark:text-white font-normal leading-6 truncate">
            {format(new Date(String(row.executedAt)), 'MMM dd, yyyy HH:mm:ss')}
          </p>
        ),
      },
      {
        key: 'endTime',
        name: 'End Time',
        width: 'minmax(140px, 1.5fr)',
        renderCell: ({ row }) => {
          const startTime = new Date(String(row.executedAt));
          const endTime = new Date(startTime.getTime() + Number(row.durationMs));
          return (
            <p className="text-sm text-gray-900 dark:text-white font-normal leading-6 truncate">
              {format(endTime, 'MMM dd, yyyy HH:mm:ss')}
            </p>
          );
        },
      },
      {
        key: 'success',
        name: 'Status',
        width: 'minmax(80px, 1fr)',
        renderCell: ({ row }) => (
          <div className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full shrink-0 ${row.success ? 'bg-green-600 dark:bg-green-400' : 'bg-red-600 dark:bg-red-400'}`}
            />
            <p className="text-sm text-gray-900 dark:text-white font-normal leading-6 truncate">
              {row.success ? 'Success' : 'Failure'}
            </p>
          </div>
        ),
      },
      {
        key: 'statusCode',
        name: 'Status Code',
        width: 'minmax(70px, 1fr)',
        renderCell: ({ row }) => {
          const code = Number(row.statusCode);
          return (
            <p
              className={`text-sm font-normal leading-6 ${
                code >= 200 && code < 300
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-red-600 dark:text-red-400'
              }`}
            >
              {code}
            </p>
          );
        },
      },
      {
        key: 'durationMs',
        name: 'Duration',
        width: 'minmax(70px, 1fr)',
        renderCell: ({ row }) => (
          <p className="text-sm text-gray-900 dark:text-white font-normal leading-6">
            {Number(row.durationMs)}ms
          </p>
        ),
      },
      {
        key: 'message',
        name: 'Message',
        width: 'minmax(100px, 3fr)',
        renderCell: ({ row }) => (
          <p className="text-sm text-gray-900 dark:text-white font-normal leading-6 truncate">
            {String(row.message ?? '') || '-'}
          </p>
        ),
      },
    ];

    return defs;
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-0 overflow-hidden px-4 py-4">
        {error ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-red-600 dark:text-red-400">
              {error instanceof Error ? error.message : 'Failed to load execution logs'}
            </p>
          </div>
        ) : (
          <LogsDataGrid columnDefs={columns} data={logs} noPadding={false} loading={isLoading} />
        )}
      </div>
    </div>
  );
}

export default ScheduleLogs;
