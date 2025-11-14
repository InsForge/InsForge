import { useEffect, useState, useMemo } from 'react';
import { ChevronRight } from 'lucide-react';
import { Button } from '@/components/radix/Button';
import { LogsTable, LogsTableColumn } from '@/features/logs/components/LogsTable';
import { scheduleService } from '@/features/schedules/services/schedule.service';
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

  const columns = useMemo(
    (): LogsTableColumn<ExecutionLog>[] => [
      {
        key: 'id',
        label: 'Run ID',
        width: '150px',
        render: (log) => (
          <p className="text-sm text-gray-900 dark:text-white font-mono leading-6 truncate">
            {log.id.slice(0, 8)}...
          </p>
        ),
      },
      {
        key: 'executedAt',
        label: 'Start Time',
        width: '200px',
        render: (log) => (
          <p className="text-sm text-gray-900 dark:text-white font-normal leading-6">
            {format(new Date(log.executedAt), 'MMM dd, yyyy HH:mm:ss')}
          </p>
        ),
      },
      {
        key: 'durationMs',
        label: 'End Time',
        width: '200px',
        render: (log) => {
          const startTime = new Date(log.executedAt);
          const endTime = new Date(startTime.getTime() + log.durationMs);
          return (
            <p className="text-sm text-gray-900 dark:text-white font-normal leading-6">
              {format(endTime, 'MMM dd, yyyy HH:mm:ss')}
            </p>
          );
        },
      },
      {
        key: 'success',
        label: 'Status',
        width: '120px',
        render: (log) => (
          <div className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full ${log.success ? 'bg-green-600 dark:bg-green-400' : 'bg-red-600 dark:bg-red-400'}`}
            />
            <p className="text-sm text-gray-900 dark:text-white font-normal leading-6">
              {log.success ? 'Success' : 'Failure'}
            </p>
          </div>
        ),
      },
      {
        key: 'statusCode',
        label: 'Status Code',
        width: '120px',
        render: (log) => (
          <p
            className={`text-sm font-normal leading-6 ${log.statusCode >= 200 && log.statusCode < 300 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
          >
            {log.statusCode}
          </p>
        ),
      },
      {
        key: 'durationMs',
        label: 'Duration (ms)',
        width: '130px',
        render: (log) => (
          <p className="text-sm text-gray-900 dark:text-white font-normal leading-6">
            {log.durationMs}
          </p>
        ),
      },
      {
        key: 'message',
        label: 'Message',
        render: (log) => (
          <p className="text-sm text-gray-900 dark:text-white font-normal leading-6 break-all">
            {log.message || '-'}
          </p>
        ),
      },
    ],
    []
  );

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
          <LogsTable<ExecutionLog>
            columns={columns}
            data={logs}
            isLoading={isLoading}
            emptyMessage="No execution logs found"
          />
        )}
      </div>
    </div>
  );
}

export default ScheduleExecutionLogs;
