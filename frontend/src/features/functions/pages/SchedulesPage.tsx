import { useState, useCallback, useMemo } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import { useSchedules } from '@/features/functions/hooks/useSchedules';
import {
  Button,
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components';
import { ScheduleFormDialog } from '../components/ScheduleFormDialog';
import type { ScheduleFormSchema } from '../types';
import { normalizeHeaders } from '../helpers';
import ScheduleRow from '../components/ScheduleRow';
import ScheduleLogs from '../components/ScheduleLogs';
import { Alert, AlertDescription } from '@/components/radix/Alert';
import ScheduleEmptyState from '../components/ScheduleEmptyState';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { useToast } from '@/lib/hooks/useToast';
import RefreshIcon from '@/assets/icons/refresh.svg?react';

const PAGE_SIZE = 50;

export default function SchedulesPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedScheduleForLogs, setSelectedScheduleForLogs] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const { confirm, confirmDialogProps } = useConfirm();

  const { showToast } = useToast();
  const {
    schedules,
    isLoading: isLoadingSchedules,
    error: schedulesError,
    createSchedule,
    updateSchedule,
    deleteSchedule: deleteScheduleFn,
    isUpdating,
    isDeleting: isDeletingSchedule,
    toggleSchedule: toggleScheduleFn,
    refetch,
  } = useSchedules();

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refetch();
    } finally {
      setIsRefreshing(false);
    }
  };

  // Paginate schedules
  const paginatedSchedules = useMemo(() => {
    const offset = (currentPage - 1) * PAGE_SIZE;
    return schedules.slice(offset, offset + PAGE_SIZE);
  }, [schedules, currentPage]);

  const totalPages = Math.ceil(schedules.length / PAGE_SIZE);

  const handleDeleteSchedule = useCallback(
    async (scheduleId: string) => {
      const schedule = schedules.find((s) => s.id === scheduleId);
      try {
        const confirmed = await confirm({
          title: 'Delete Schedule',
          description: `Are you sure you want to delete the schedule "${schedule?.name}"? This action cannot be undone.`,
          confirmText: 'Delete',
          cancelText: 'Cancel',
          destructive: true,
        });

        if (!confirmed) {
          return;
        }

        await deleteScheduleFn(scheduleId);
      } catch (err) {
        console.error('delete schedule error', err);
      }
    },
    [schedules, confirm, deleteScheduleFn]
  );

  const handleEditSchedule = useCallback((scheduleId: string) => {
    setEditingScheduleId(scheduleId);
    setEditOpen(true);
  }, []);

  const handleViewLogs = useCallback((scheduleId: string, scheduleName: string) => {
    setSelectedScheduleForLogs({ id: scheduleId, name: scheduleName });
  }, []);

  const handleBackFromLogs = useCallback(() => {
    setSelectedScheduleForLogs(null);
  }, []);

  const handleCreateOnSubmit = async (values: ScheduleFormSchema) => {
    try {
      const ok = await createSchedule({
        name: values.name,
        cronSchedule: values.cronSchedule,
        functionUrl: values.functionUrl,
        httpMethod: values.httpMethod || 'POST',
        headers: normalizeHeaders(values.headers),
        body: values.body ?? undefined,
      });
      if (!ok) {
        showToast('Failed to create schedule', 'error');
        throw new Error('create failed');
      }
    } catch (err) {
      console.error('create schedule error', err);
      throw err;
    }
  };

  const handleEditOnSubmit = async (values: ScheduleFormSchema) => {
    try {
      if (!editingScheduleId) {
        return;
      }
      const ok = await updateSchedule(editingScheduleId, {
        name: values.name,
        cronSchedule: values.cronSchedule,
        functionUrl: values.functionUrl,
        httpMethod: values.httpMethod || 'POST',
        headers: normalizeHeaders(values.headers),
        body: values.body ?? undefined,
      });
      if (!ok) {
        showToast('Failed to update schedule', 'error');
        throw new Error('update failed');
      }
    } catch (err) {
      console.error('update schedule error', err);
      throw err;
    }
  };

  // Show logs detail view if schedule is selected
  if (selectedScheduleForLogs) {
    return (
      <div className="h-full flex flex-col overflow-hidden">
        <div className="flex items-center gap-2.5 p-4 border-b border-border-gray dark:border-neutral-600">
          <button
            onClick={handleBackFromLogs}
            className="text-xl text-zinc-500 dark:text-neutral-400 hover:text-zinc-950 dark:hover:text-white transition-colors"
          >
            Schedules
          </button>
          <ChevronRight className="w-5 h-5 text-muted-foreground dark:text-neutral-400" />
          <p className="text-xl text-zinc-950 dark:text-white">{selectedScheduleForLogs.name}</p>
        </div>
        <div className="flex-1 min-h-0">
          <ScheduleLogs scheduleId={selectedScheduleForLogs.id} />
        </div>
      </div>
    );
  }

  // Default list view
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex flex-col gap-6 p-4">
        {/* Header Section */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-normal text-zinc-950 dark:text-white">Schedules</h1>

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

          {/* Add button */}
          <Button
            title="Create a new schedule"
            className="h-9 px-4 font-medium gap-1.5 dark:bg-emerald-300 dark:hover:bg-emerald-400 dark:text-black"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="w-4 h-4" />
            Add Schedule
          </Button>
        </div>

        {/* Error Alert */}
        {schedulesError && (
          <Alert variant="destructive">
            <AlertDescription>Failed to load schedules. Please try again.</AlertDescription>
          </Alert>
        )}

        {/* Table Header */}
        <div className="grid grid-cols-14 px-3 text-sm text-muted-foreground dark:text-neutral-400 gap-x-1">
          <div className="col-span-2 py-1 px-3">Name</div>
          <div className="col-span-4 py-1 px-3">Function URL</div>
          <div className="col-span-2 py-1 px-3">Next Run</div>
          <div className="col-span-2 py-1 px-3">Last Run</div>
          <div className="col-span-2 py-1 px-3">Created</div>
          <div className="col-span-1 py-1 px-3">Active</div>
          <div className="col-span-1 py-1 px-3" />
        </div>
      </div>

      {/* Create dialog */}
      <ScheduleFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        onSubmit={handleCreateOnSubmit}
      />

      {/* Edit dialog */}
      {editingScheduleId && (
        <ScheduleFormDialog
          open={editOpen}
          onOpenChange={(open) => {
            setEditOpen(open);
            if (!open) {
              setEditingScheduleId(null);
            }
          }}
          mode="edit"
          scheduleId={editingScheduleId}
          onSubmit={handleEditOnSubmit}
        />
      )}

      {/* Confirm delete dialog managed by useConfirm hook */}
      <ConfirmDialog {...confirmDialogProps} />

      {/* Scrollable Table Body */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 relative">
        <div className="flex flex-col gap-2">
          {isLoadingSchedules ? (
            [...Array(4)].map((_, i) => <Skeleton key={i} className="h-14 rounded-[8px]" />)
          ) : schedules.length === 0 ? (
            <ScheduleEmptyState />
          ) : paginatedSchedules.length >= 1 ? (
            paginatedSchedules.map((s) => (
              <ScheduleRow
                key={s.id}
                schedule={s}
                onClick={() => void handleViewLogs(s.id, s.name)}
                onEdit={(id) => handleEditSchedule(id)}
                onDelete={(id) => void handleDeleteSchedule(id)}
                onToggle={(id, isActive) => void toggleScheduleFn(id, isActive)}
                isLoading={Boolean(isUpdating || isDeletingSchedule)}
              />
            ))
          ) : null}

          {/* Pagination controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-end gap-2 py-2">
              <Button
                variant="ghost"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >
                Prev
              </Button>
              <div className="text-sm text-zinc-600 dark:text-zinc-400">
                Page {currentPage} of {totalPages}
              </div>
              <Button
                variant="ghost"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
              >
                Next
              </Button>
            </div>
          )}
        </div>

        {/* Loading mask overlay */}
        {isRefreshing && (
          <div className="absolute inset-0 bg-white dark:bg-neutral-800 flex items-center justify-center z-50">
            <div className="flex items-center gap-1">
              <div className="w-5 h-5 border-2 border-zinc-500 dark:border-neutral-700 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-zinc-500 dark:text-zinc-400">Loading</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
