


export interface Schedule {
  id: string;
  name: string;
  cronSchedule: string;
  functionUrl: string;
  httpMethod: string;
  cronJobId: string | null;
  createdAt: string;
  updatedAt: string;
  lastExecutedAt?: string | null;
  isActive: boolean;
}

export interface ScheduleRow extends Schedule {
  [key: string]: any;
}
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus } from 'lucide-react';
import { useSchedules, useToggleScheduleStatus, useDeleteSchedule } from '@/features/schedules/hooks/useSchedules';
import { ScheduleActionsCell } from '../components/ScheduleActionsCell';
import { ScheduleToggleCell } from '../components/ScheduleToggleCell';
import { Button } from '@/components/radix/Button';
import { Alert, AlertDescription } from '@/components/radix/Alert';
import { SearchInput, SelectionClearButton, DeleteActionButton } from '@/components';
import { EmptyState } from '@/components/EmptyState';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/radix/Tooltip';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { useToast } from '@/lib/hooks/useToast';
import DataGrid from '@/components/datagrid/DataGrid';
import type { DataGridColumn } from '@/components/datagrid/datagridTypes';
import { formatDistanceToNow, parseISO } from 'date-fns';

const PAGE_SIZE = 50;

export function CronJobsContent() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);

  const { confirm } = useConfirm();
  const { showToast } = useToast();

  const {
    data: schedules = [],
    isLoading: isLoadingSchedules,
    error: schedulesError,
  } = useSchedules();

  const { mutate: toggleStatus, isPending: isTogglingStatus } = useToggleScheduleStatus();
  const { mutate: deleteSchedule, isPending: isDeletingSchedule } = useDeleteSchedule();

  // Reset page when search query changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  // Clear selected rows when data changes
  useEffect(() => {
    setSelectedRows(new Set());
  }, [schedules]);

  // Filter schedules based on search query
  const filteredSchedules = useMemo(() => {
    if (!searchQuery.trim()) {
      return schedules;
    }

    const query = searchQuery.toLowerCase();
    return schedules.filter(
      (schedule) =>
        schedule.name.toLowerCase().includes(query) ||
        schedule.functionUrl.toLowerCase().includes(query) ||
        schedule.cronSchedule.toLowerCase().includes(query)
    );
  }, [schedules, searchQuery]);

  // Paginate filtered schedules
  const paginatedSchedules = useMemo(() => {
    const offset = (currentPage - 1) * PAGE_SIZE;
    return filteredSchedules.slice(offset, offset + PAGE_SIZE);
  }, [filteredSchedules, currentPage]);

  const totalPages = Math.ceil(filteredSchedules.length / PAGE_SIZE);

  const handleToggleStatus = useCallback(
    (scheduleId: string, isActive: boolean) => {
      toggleStatus({ scheduleId, isActive });
    },
    [toggleStatus]
  );

  const handleDeleteSchedule = useCallback(
    async (scheduleId: string) => {
      const schedule = schedules.find((s) => s.id === scheduleId);
      const shouldDelete = await confirm({
        title: 'Delete Cron Job',
        description: `Are you sure you want to delete the cron job "${schedule?.name}"? This action cannot be undone.`,
        confirmText: 'Delete',
        destructive: true,
      });

      if (shouldDelete) {
        deleteSchedule(scheduleId);
        setSelectedRows((prev) => {
          const updated = new Set(prev);
          updated.delete(scheduleId);
          return updated;
        });
      }
    },
    [schedules, confirm, deleteSchedule]
  );

  const handleBulkDelete = useCallback(
    async (ids: string[]) => {
      const shouldDelete = await confirm({
        title: `Delete ${ids.length} ${ids.length === 1 ? 'Cron Job' : 'Cron Jobs'}`,
        description: `Are you sure you want to delete ${ids.length} ${ids.length === 1 ? 'cron job' : 'cron jobs'}? This action cannot be undone.`,
        confirmText: 'Delete',
        destructive: true,
      });

      if (shouldDelete) {
        ids.forEach((id) => {
          deleteSchedule(id);
        });
        setSelectedRows(new Set());
      }
    },
    [confirm, deleteSchedule]
  );

  const handleViewDetails = useCallback((schedule: ScheduleRow) => {
    // TODO: Navigate to schedule details page
    console.log('View details:', schedule);
    showToast('View details coming soon', 'info');
  }, [showToast]);

  const columns: DataGridColumn<ScheduleRow>[] = [
    {
      key: 'name',
      name: 'Name',
      width: 200,
      sortable: true,
      renderCell: ({ row }) => (
        <span className="font-medium dark:text-zinc-200">{row.name}</span>
      ),
    },
    {
      key: 'functionUrl',
      name: 'Function URL',
      width: 300,
      sortable: true,
      renderCell: ({ row }) => (
        <span className="text-sm text-zinc-600 dark:text-zinc-400 truncate" title={row.functionUrl}>
          {row.functionUrl}
        </span>
      ),
    },
    {
      key: 'cronSchedule',
      name: 'Schedule Period',
      width: 150,
      sortable: true,
      renderCell: ({ row }) => (
        <span className="font-mono text-sm bg-zinc-100 dark:bg-neutral-700 px-2 py-1 rounded text-zinc-900 dark:text-zinc-200">
          {row.cronSchedule}
        </span>
      ),
    },
    {
      key: 'lastExecutedAt',
      name: 'Next Run',
      width: 180,
      sortable: true,
      renderCell: ({ row }) => (
        <span className="text-sm text-zinc-600 dark:text-zinc-400">
          {row.lastExecutedAt
            ? String(new Date(row.lastExecutedAt).toLocaleDateString() + ' ' + new Date(row.lastExecutedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
            : 'Not executed yet'}
        </span>
      ),
    },
    {
      key: 'createdAt',
      name: 'Created At',
      width: 180,
      sortable: true,
      renderCell: ({ row }) => (
        <span className="text-sm text-zinc-600 dark:text-zinc-400">
          {new Date(row.createdAt).toLocaleDateString()} {new Date(row.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      ),
    },
    {
      key: 'isActive',
      name: 'Active',
      width: 100,
      sortable: false,
      renderCell: ({ row }) => (
        <ScheduleToggleCell
          row={row}
          isLoading={isTogglingStatus || isDeletingSchedule}
          onToggle={handleToggleStatus}
        />
      ),
    },
    {
      key: 'actions',
      name: '',
      width: 50,
      sortable: false,
      resizable: false,
      renderCell: ({ row }) => (
        <ScheduleActionsCell
          row={row}
          onViewDetails={handleViewDetails}
          onDelete={handleDeleteSchedule}
        />
      ),
    },
  ];

  return (
    <div className="h-full flex flex-col gap-4 p-4 bg-bg-gray dark:bg-neutral-800 overflow-hidden">
      {/* Header Section */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-black dark:text-white">Cron Jobs</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Schedule recurring jobs in PostgreSQL
          </p>
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button className="h-10 px-4 font-medium gap-1.5 dark:bg-emerald-300 dark:hover:bg-emerald-400 dark:text-black">
                <Plus className="w-5 h-5" />
                Add Cron Job
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Create a new cron job</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Error Alert */}
      {schedulesError && (
        <Alert variant="destructive">
          <AlertDescription>
            Failed to load cron jobs. Please try again.
          </AlertDescription>
        </Alert>
      )}

      {/* Search and Actions Bar */}
      <div className="flex items-center justify-between gap-3 flex-shrink-0">
        {selectedRows.size > 0 ? (
          <div className="flex items-center gap-3">
            <SelectionClearButton
              selectedCount={selectedRows.size}
              itemType="cron job"
              onClear={() => setSelectedRows(new Set())}
            />
            <DeleteActionButton
              selectedCount={selectedRows.size}
              itemType="cron job"
              onDelete={() => void handleBulkDelete(Array.from(selectedRows))}
             
            />
          </div>
        ) : (
          <SearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search cron jobs by name"
            className="flex-1 max-w-96 dark:bg-neutral-700 dark:text-zinc-300 dark:border-neutral-600"
            debounceTime={300}
          />
        )}
      </div>

      {/* DataGrid */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {!isLoadingSchedules && filteredSchedules.length === 0 && !searchQuery ? (
          <div className="h-full flex items-center justify-center">
            <EmptyState
              title="No Cron Jobs"
              description="Create your first cron job to get started"
            />
          </div>
        ) : (
          <DataGrid<ScheduleRow>
            data={paginatedSchedules}
            columns={columns}
            loading={isLoadingSchedules}
            rowKeyGetter={(row) => row.id}
            selectedRows={selectedRows}
            onSelectedRowsChange={setSelectedRows}
            showSelection={true}
            showPagination={true}
            currentPage={currentPage}
            totalPages={totalPages}
            pageSize={PAGE_SIZE}
            totalRecords={filteredSchedules.length}
            onPageChange={setCurrentPage}
            emptyState={
              <div className="text-center">
                {searchQuery ? (
                  <>
                    <p className="text-zinc-600 dark:text-zinc-400">No cron jobs match your search</p>
                    <p className="text-sm text-zinc-500 dark:text-zinc-500 mt-1">
                      Try adjusting your search criteria
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-zinc-600 dark:text-zinc-400">No cron jobs found</p>
                    <p className="text-sm text-zinc-500 dark:text-zinc-500 mt-1">
                      Create one to get started
                    </p>
                  </>
                )}
              </div>
            }
          />
        )}
      </div>
    </div>
  );
}
