import { useEffect, useState, useMemo } from 'react';
import { ChevronRight } from 'lucide-react';
import { Button } from '@/components/radix/Button';
import { LogsDataGrid, LogsColumnDef } from '@/features/logs/components/LogsDataGrid';
import { scheduleService } from '@/features/functions/services/schedule.service';
import type { ExecutionLog } from '@insforge/shared-schemas';
import { format } from 'date-fns';

interface ScheduleExecutionLogsProps {
  scheduleId: string;
  scheduleName: string;
  onBack: () => void;
}

export function ScheduleExecutionLogs({
  scheduleId,
  scheduleName,
  onBack,
}: ScheduleExecutionLogsProps) {
  const [logs, setLogs] = useState<ExecutionLog[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPage] = useState(1);
  const PAGE_SIZE = 50;

  useEffect(() => {
    const fetchLogs = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const offset = (currentPage - 1) * PAGE_SIZE;
        const result = await scheduleService.listExecutionLogs(scheduleId, PAGE_SIZE, offset);
        setLogs(result.logs || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load execution logs');
      } finally {
        setIsLoading(false);
      }
    };

    void fetchLogs();
  }, [scheduleId, currentPage]);

  const columns = useMemo((): LogsColumnDef[] => {
    const defs: LogsColumnDef[] = [
      {
        key: 'id',
        name: 'Run ID',
        width: '150px',
        renderCell: ({ row }) => (
          <p className="text-sm text-gray-900 dark:text-white font-mono leading-6 truncate">
            {String((row as ExecutionLog).id).slice(0, 8)}...
          </p>
        ),
      },
      {
        key: 'executedAt',
        name: 'Start Time',
        width: '200px',
        renderCell: ({ row }) => (
          <p className="text-sm text-gray-900 dark:text-white font-normal leading-6">
            {format(new Date((row as ExecutionLog).executedAt), 'MMM dd, yyyy HH:mm:ss')}
          </p>
        ),
      },
      {
        key: 'endTime',
        name: 'End Time',
        width: '200px',
        renderCell: ({ row }) => {
          const r = row as ExecutionLog;
          const startTime = new Date(r.executedAt);
          const endTime = new Date(startTime.getTime() + r.durationMs);
          return (
            <p className="text-sm text-gray-900 dark:text-white font-normal leading-6">
              {format(endTime, 'MMM dd, yyyy HH:mm:ss')}
            </p>
          );
        },
      },
      {
        key: 'success',
        name: 'Status',
        width: '120px',
        renderCell: ({ row }) => {
          const log = row as ExecutionLog;
          return (
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${log.success ? 'bg-green-600 dark:bg-green-400' : 'bg-red-600 dark:bg-red-400'}`}
              />
              <p className="text-sm text-gray-900 dark:text-white font-normal leading-6">
                {log.success ? 'Success' : 'Failure'}
              </p>
            </div>
          );
        },
      },
      {
        key: 'statusCode',
        name: 'Status Code',
        width: '120px',
        renderCell: ({ row }) => (
          <p
            className={`text-sm font-normal leading-6 ${
              (row as ExecutionLog).statusCode >= 200 && (row as ExecutionLog).statusCode < 300
                ? 'text-green-600 dark:text-green-400'
                : 'text-red-600 dark:text-red-400'
            }`}
          >
            {(row as ExecutionLog).statusCode}
          </p>
        ),
      },
      {
        key: 'durationMs',
        name: 'Duration (ms)',
        width: '130px',
        renderCell: ({ row }) => (
          <p className="text-sm text-gray-900 dark:text-white font-normal leading-6">
            {(row as ExecutionLog).durationMs}
          </p>
        ),
      },
      {
        key: 'message',
        name: 'Message',
        renderCell: ({ row }) => (
          <p className="text-sm text-gray-900 dark:text-white font-normal leading-6 break-all">
            {(row as ExecutionLog).message || '-'}
          </p>
        ),
      },
    ];

    return defs;
  }, []);

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Breadcrumb header */}
      <div className="flex items-center gap-2 px-4 py-4 border-b border-border-gray dark:border-neutral-600">
        <Button
          variant="ghost"
          className="p-0 h-auto text-base font-semibold text-zinc-950 dark:text-white hover:text-zinc-700 dark:hover:text-zinc-300"
          onClick={onBack}
          title="Back to schedules"
        >
          Cron Jobs
        </Button>
        <ChevronRight className="h-5 w-5 text-zinc-400 dark:text-zinc-500" />
        <h2 className="text-base font-semibold text-zinc-950 dark:text-white">{scheduleName}</h2>
      </div>

      {/* Logs table */}
      <div className="flex-1 min-h-0 overflow-hidden px-4">
        {error ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        ) : (
          <LogsDataGrid columnDefs={columns} data={logs} noPadding={false} loading={isLoading} />
        )}
      </div>
    </div>
  );
}

export default ScheduleExecutionLogs;
