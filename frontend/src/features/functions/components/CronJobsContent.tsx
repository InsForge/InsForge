import { useState, useCallback, useMemo } from 'react';
import { Plus } from 'lucide-react';
import { useSchedules } from '@/features/schedules/hooks/useSchedules';
import { Button } from '@/components/radix/Button';
import { CronJobFormDialog, CronJobForm } from './CronJobFormDialog';
import ScheduleRow from './ScheduleRow';
import ScheduleExecutionLogs from './ScheduleExecutionLogs';
import { Skeleton } from '@/components/radix/Skeleton';
import { Alert, AlertDescription } from '@/components/radix/Alert';
import { SearchInput } from '@/components';
import { EmptyState } from '@/components/EmptyState';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { useToast } from '@/lib/hooks/useToast';
// DataGrid is not used in the list view; keep the import commented out in case we revert to grid view
// import DataGrid from '@/components/datagrid/DataGrid';

const PAGE_SIZE = 50;

export function CronJobsContent() {
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedScheduleForLogs, setSelectedScheduleForLogs] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const { confirm, confirmDialogProps } = useConfirm();

  const { showToast } = useToast();
  const {
    schedules,
    filteredSchedules,
    searchQuery,
    setSearchQuery,
    isLoading: isLoadingSchedules, // Loading state for schedules
    error: schedulesError, // Error state for schedules
    createOrUpdate, // Function to create or update schedules
    deleteSchedule: deleteScheduleFn, // Function to delete a schedule
    isToggling: isTogglingStatus, // New toggling state
    isDeleting: isDeletingSchedule, // New deleting state
    toggleSchedule: toggleScheduleFn,
  } = useSchedules();

  // Paginate filtered schedules
  const paginatedSchedules = useMemo(() => {
    const offset = (currentPage - 1) * PAGE_SIZE;
    return filteredSchedules.slice(offset, offset + PAGE_SIZE);
  }, [filteredSchedules, currentPage]);

  const totalPages = Math.ceil(filteredSchedules.length / PAGE_SIZE);

  // toggle handler is available via the schedules hook (toggleScheduleFn) when needed.

  const handleDeleteSchedule = useCallback(
    async (scheduleId: string) => {
      const schedule = schedules.find((s) => s.id === scheduleId);
      try {
        const confirmed = await confirm({
          title: 'Delete Cron Job',
          description: `Are you sure you want to delete the cron job "${schedule?.name}"? This action cannot be undone.`,
          confirmText: 'Delete',
          cancelText: 'Cancel',
          destructive: true,
        });

        if (!confirmed) {
          return;
        }

        await deleteScheduleFn(scheduleId);
      } catch (err) {
        console.error('delete cron job error', err);
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

  const handleCreateOnSubmit = async (values: CronJobForm) => {
    try {
      const normalizeHeaders = (h: unknown): Record<string, string> | undefined => {
        if (h === null) {
          return undefined;
        }
        if (typeof h === 'string') {
          try {
            const parsed = JSON.parse(h);
            if (parsed && typeof parsed === 'object') {
              return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)]));
            }
            return undefined;
          } catch {
            return undefined;
          }
        }
        if (typeof h === 'object') {
          return Object.fromEntries(
            Object.entries(h as Record<string, unknown>).map(([k, v]) => [k, String(v)])
          );
        }
        return undefined;
      };

      const ok = await createOrUpdate({
        name: values.name,
        cronSchedule: values.cronSchedule,
        functionUrl: values.functionUrl,
        httpMethod: values.httpMethod || 'POST',
        headers: normalizeHeaders(values.headers),
        body: values.body ?? undefined,
      });
      if (!ok) {
        showToast('Failed to create cron job', 'error');
        throw new Error('create failed');
      }
    } catch (err) {
      console.error('create cron job error', err);
      throw err;
    }
  };

  const handleEditOnSubmit = async (values: CronJobForm) => {
    try {
      if (!editingScheduleId) {
        return;
      }
      const normalizeHeaders = (h: unknown): Record<string, string> | undefined => {
        if (h === null) {
          return undefined;
        }
        if (typeof h === 'string') {
          try {
            const parsed = JSON.parse(h);
            if (parsed && typeof parsed === 'object') {
              return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)]));
            }
            return undefined;
          } catch {
            return undefined;
          }
        }
        if (typeof h === 'object') {
          return Object.fromEntries(
            Object.entries(h as Record<string, unknown>).map(([k, v]) => [k, String(v)])
          );
        }
        return undefined;
      };

      const ok = await createOrUpdate({
        id: editingScheduleId,
        name: values.name,
        cronSchedule: values.cronSchedule,
        functionUrl: values.functionUrl,
        httpMethod: values.httpMethod || 'POST',
        headers: normalizeHeaders(values.headers),
        body: values.body ?? undefined,
      });
      if (!ok) {
        showToast('Failed to update cron job', 'error');
        throw new Error('update failed');
      }
    } catch (err) {
      console.error('update cron job error', err);
      throw err;
    }
  };

  // Show logs detail view if schedule is selected
  if (selectedScheduleForLogs) {
    return (
      <div className="h-full flex flex-col bg-bg-gray dark:bg-neutral-800">
        <ScheduleExecutionLogs
          scheduleId={selectedScheduleForLogs.id}
          scheduleName={selectedScheduleForLogs.name}
          onBack={handleBackFromLogs}
        />
      </div>
    );
  }

  // columns are not used in the list view; keep helper functions in their file for DataGrid use if needed

  return (
    <div className="h-full flex flex-col gap-4 p-4 bg-bg-gray dark:bg-neutral-800 overflow-hidden">
      {/* Header Section */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-black dark:text-white">Schedules</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Schedule recurring jobs in PostgreSQL
          </p>
        </div>
        {/* Avoid composing multiple refs via asChild — use a plain Button with native title to prevent
            ref composition loops that can cause "Maximum update depth exceeded" errors. */}
        <Button
          title="Create a new cron job"
          className="h-10 px-4 font-medium gap-1.5 dark:bg-emerald-300 dark:hover:bg-emerald-400 dark:text-black"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="w-5 h-5" />
          Add Cron Job
        </Button>
      </div>

      {/* Error Alert */}
      {schedulesError && (
        <Alert variant="destructive">
          <AlertDescription>Failed to load cron jobs. Please try again.</AlertDescription>
        </Alert>
      )}

      {/* Search Bar */}
      <div className="flex-shrink-0">
        <SearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search cron jobs by name"
          className="flex-1 max-w-96 dark:bg-neutral-700 dark:text-zinc-300 dark:border-neutral-600"
          debounceTime={300}
        />
      </div>
      {/* Create dialog */}
      <CronJobFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        onSubmit={handleCreateOnSubmit}
      />

      {/* Edit dialog */}
      {editingScheduleId && (
        <CronJobFormDialog
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

      {/* List view matching FunctionRow pattern with header and horizontal scroll */}
      <div className="flex-1 min-h-0 overflow-auto">
        {!isLoadingSchedules && filteredSchedules.length === 0 && !searchQuery ? (
          <div className="h-full flex items-center justify-center">
            <EmptyState
              title="No Cron Jobs"
              description="Create your first cron job to get started"
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            {/* Header that mirrors Function list header */}
            <div className="min-w-[1400px]">
              <div className="grid grid-cols-14 px-3 text-sm text-muted-foreground dark:text-neutral-400 gap-x-1">
                <div className="col-span-2 py-1 px-3">Name</div>
                <div className="col-span-4 py-1 px-3">Function URL</div>
                <div className="col-span-2 py-1 px-3">Next Run</div>
                <div className="col-span-2 py-1 px-3">Last Run</div>
                <div className="col-span-2 py-1 px-3">Created</div>
                <div className="col-span-1 py-1 px-3">Status</div>
                <div className="col-span-1 py-1 px-3">Actions</div>
              </div>

              <div className="flex flex-col gap-2 mt-2">
                {isLoadingSchedules ? (
                  [...Array(4)].map((_, i) => (
                    <Skeleton key={i} className="h-14 rounded-[8px] cols-span-full" />
                  ))
                ) : paginatedSchedules.length >= 1 ? (
                  paginatedSchedules.map((s) => (
                    <ScheduleRow
                      key={s.id}
                      schedule={s}
                      onClick={() => void handleViewLogs(s.id, s.name)}
                      onEdit={(id) => handleEditSchedule(id)}
                      onDelete={(id) => void handleDeleteSchedule(id)}
                      onToggle={(id, isActive) => void toggleScheduleFn(id, isActive)}
                      isLoading={Boolean(isTogglingStatus || isDeletingSchedule)}
                    />
                  ))
                ) : (
                  <div className="cols-span-full text-center py-6">
                    {searchQuery ? (
                      <>
                        <p className="text-zinc-600 dark:text-zinc-400">
                          No cron jobs match your search
                        </p>
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
                )}

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
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
