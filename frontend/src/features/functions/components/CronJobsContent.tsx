import type { ScheduleRow } from '../types/schedules';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus } from 'lucide-react';
import { useSchedules } from '@/features/schedules/hooks/useSchedules';
import { Button } from '@/components/radix/Button';
import { CronJobFormDialog } from './CronJobFormDialog';
import { getCronJobColumns } from './CronJobsColumns';
import { Alert, AlertDescription } from '@/components/radix/Alert';
import { SearchInput, SelectionClearButton, DeleteActionButton } from '@/components';
import { EmptyState } from '@/components/EmptyState';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/lib/hooks/useToast';
import DataGrid from '@/components/datagrid/DataGrid';

const PAGE_SIZE = 50;

export function CronJobsContent() {
  // use search query from the schedules hook to keep a single source of truth
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);

  const { showToast } = useToast();
  const {
    schedules,
    filteredSchedules,
    searchQuery,
    setSearchQuery,
    isLoading: isLoadingSchedules,
    error: schedulesError,
    createOrUpdate,
    deleteSchedule: deleteScheduleFn,
    toggleSchedule: toggleScheduleFn,
    isToggling: isTogglingStatus,
    isDeleting: isDeletingSchedule,
  } = useSchedules();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmIds, setConfirmIds] = useState<string[]>([]);
  const [confirmTitle, setConfirmTitle] = useState<string | undefined>(undefined);
  const [confirmDescription, setConfirmDescription] = useState<string | undefined>(undefined);

  // schedules, statuses and functions come from the single `useSchedules` hook above

  // Reset page when search query changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  // Clear selected rows when data changes
  useEffect(() => {
    setSelectedRows(new Set());
  }, [schedules]);

  // use `filteredSchedules` from the hook (already memoized there)

  // Paginate filtered schedules
  const paginatedSchedules = useMemo(() => {
    const offset = (currentPage - 1) * PAGE_SIZE;
    return filteredSchedules.slice(offset, offset + PAGE_SIZE);
  }, [filteredSchedules, currentPage]);

  const totalPages = Math.ceil(filteredSchedules.length / PAGE_SIZE);

  const handleToggleStatus = useCallback(
    (scheduleId: string, isActive: boolean) => {
      void toggleScheduleFn(scheduleId, isActive);
    },
    [toggleScheduleFn]
  );

  const handleDeleteSchedule = useCallback(
    (scheduleId: string) => {
      const schedule = schedules.find((s) => s.id === scheduleId);
      setConfirmIds([scheduleId]);
      setConfirmTitle('Delete Cron Job');
      setConfirmDescription(
        `Are you sure you want to delete the cron job "${schedule?.name}"? This action cannot be undone.`
      );
      setConfirmOpen(true);
    },
    [schedules]
  );

  const handleBulkDelete = useCallback((ids: string[]) => {
    setConfirmIds(ids);
    setConfirmTitle(`Delete ${ids.length} ${ids.length === 1 ? 'Cron Job' : 'Cron Jobs'}`);
    setConfirmDescription(
      `Are you sure you want to delete ${ids.length} ${ids.length === 1 ? 'cron job' : 'cron jobs'}? This action cannot be undone.`
    );
    setConfirmOpen(true);
  }, []);

  const handleEditSchedule = useCallback((scheduleId: string) => {
    setEditingScheduleId(scheduleId);
    setEditOpen(true);
  }, []);

  const columns = getCronJobColumns({
    handleEditSchedule,
    handleDeleteSchedule,
    isTogglingStatus,
    isDeletingSchedule,
    handleToggleStatus,
  });

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
      {/* Create dialog */}
      <CronJobFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        onSubmit={async (values) => {
          try {
            const normalizeHeaders = (h: unknown): Record<string, string> | undefined => {
              if (h === null) {
                return undefined;
              }
              if (typeof h === 'string') {
                try {
                  const parsed = JSON.parse(h);
                  if (parsed && typeof parsed === 'object') {
                    return Object.fromEntries(
                      Object.entries(parsed).map(([k, v]) => [k, String(v)])
                    );
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
        }}
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
          onSubmit={async (values) => {
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
                      return Object.fromEntries(
                        Object.entries(parsed).map(([k, v]) => [k, String(v)])
                      );
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
          }}
        />
      )}

      {/* Confirm delete dialog (single or bulk) — reuse shared ConfirmDialog component */}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          setConfirmOpen(open);
          if (!open) {
            setConfirmIds([]);
            setConfirmTitle(undefined);
            setConfirmDescription(undefined);
          }
        }}
        title={confirmTitle ?? 'Delete'}
        description={
          confirmDescription ??
          'Are you sure you want to delete the selected item(s)? This action cannot be undone.'
        }
        confirmText="Delete"
        cancelText="Cancel"
        destructive={true}
        onConfirm={() => {
          // perform deletions
          confirmIds.forEach((id) => {
            void deleteScheduleFn(id);
          });
          // clear selection if bulk delete
          if (confirmIds.length > 1) {
            setSelectedRows(new Set());
          } else if (confirmIds.length === 1) {
            setSelectedRows((prev) => {
              const updated = new Set(prev);
              updated.delete(confirmIds[0]);
              return updated;
            });
          }
        }}
      />

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
            }
          />
        )}
      </div>
    </div>
  );
}
