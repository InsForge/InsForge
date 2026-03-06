import { useState, useCallback, useMemo, useRef } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useSchedules } from '@/features/functions/hooks/useSchedules';
import {
  Button,
  ConfirmDialog,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@insforge/ui';
import { Skeleton, TableHeader } from '@/components';
import { ScheduleFormDialog } from '../components/ScheduleFormDialog';
import type { ScheduleFormSchema } from '../types';
import { normalizeHeaders } from '../helpers';
import ScheduleRow from '../components/ScheduleRow';
import ScheduleLogs from '../components/ScheduleLogs';
import { Alert, AlertDescription } from '@/components/radix/Alert';
import ScheduleEmptyState from '../components/ScheduleEmptyState';
import { useConfirm } from '@/lib/hooks/useConfirm';
import RefreshIcon from '@/assets/icons/refresh.svg?react';

const PAGE_SIZE = 50;

export default function SchedulesPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isScrolled, setIsScrolled] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [selectedScheduleForLogs, setSelectedScheduleForLogs] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const { confirm, confirmDialogProps } = useConfirm();

  const {
    schedules,
    isLoading,
    error: schedulesError,
    createSchedule,
    updateSchedule,
    deleteSchedule: deleteScheduleFn,
    isUpdating,
    isDeleting: isDeletingSchedule,
    toggleSchedule: toggleScheduleFn,
    refetch,
  } = useSchedules();

  const handleScroll = useCallback(() => {
    if (scrollRef.current) {
      setIsScrolled(scrollRef.current.scrollTop > 0);
    }
  }, []);

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
  }, []);

  const filteredSchedules = useMemo(() => {
    const filtered = searchQuery
      ? schedules.filter(
          (s) =>
            s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            s.functionUrl.toLowerCase().includes(searchQuery.toLowerCase()) ||
            s.functionUrl.toLowerCase().includes(searchQuery.toLowerCase())
        )
      : schedules;
    const offset = (currentPage - 1) * PAGE_SIZE;
    return filtered.slice(offset, offset + PAGE_SIZE);
  }, [schedules, searchQuery, currentPage]);

  const totalPages = Math.ceil(
    (searchQuery
      ? schedules.filter(
          (s) =>
            s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            s.functionUrl.toLowerCase().includes(searchQuery.toLowerCase()) ||
            s.functionUrl.toLowerCase().includes(searchQuery.toLowerCase())
        )
      : schedules
    ).length / PAGE_SIZE
  );

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refetch();
    } finally {
      setIsRefreshing(false);
    }
  };

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
      <div className="h-full flex flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
        <div className="flex items-center shrink-0 border-b border-[var(--alpha-8)] bg-[rgb(var(--semantic-0))]">
          <div className="flex items-center gap-3 pl-4 pr-3 py-3">
            <button
              onClick={handleBackFromLogs}
              className="flex items-center justify-center size-8 rounded border border-[var(--alpha-8)] bg-card hover:bg-[var(--alpha-8)] transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-foreground" />
            </button>
            <h1 className="text-base font-medium leading-7 text-foreground">
              {selectedScheduleForLogs.name}
            </h1>
          </div>
        </div>
        <div className="flex-1 min-h-0">
          <ScheduleLogs scheduleId={selectedScheduleForLogs.id} />
        </div>
      </div>
    );
  }

  // Default list view
  return (
    <div className="h-full flex flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
      <TableHeader
        className="min-w-[800px]"
        leftContent={
          <div className="flex flex-1 items-center gap-2 overflow-clip">
            <h1 className="shrink-0 text-base font-medium leading-7 text-foreground">Schedules</h1>
            <div className="flex h-5 w-5 shrink-0 items-center justify-center">
              <div className="h-5 w-px bg-[var(--alpha-8)]" />
            </div>
            <Button
              variant="primary"
              className="h-8 px-3 text-sm font-medium"
              onClick={() => setCreateOpen(true)}
            >
              Add Schedule
            </Button>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline-muted"
                    size="icon"
                    onClick={() => void handleRefresh()}
                    disabled={isRefreshing}
                    className="h-8 w-8"
                  >
                    <RefreshIcon className={isRefreshing ? '!size-3.5 animate-spin' : '!size-3.5'} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" align="center">
                  <p>{isRefreshing ? 'Refreshing...' : 'Refresh'}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        }
        searchValue={searchQuery}
        onSearchChange={handleSearchChange}
        searchDebounceTime={300}
        searchPlaceholder="Search schedules"
      />

      {/* Error Alert */}
      {schedulesError && (
        <div className="px-3 pt-3">
          <Alert variant="destructive">
            <AlertDescription>Failed to load schedules. Please try again.</AlertDescription>
          </Alert>
        </div>
      )}

      {/* Scrollable Content */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto relative"
      >
        {/* Sticky Table Header */}
        <div className="sticky top-0 z-10 flex h-10 items-center border-b border-[var(--alpha-8)] bg-[rgb(var(--semantic-1))] pl-2">
          <div className="flex-1 px-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Name</div>
          <div className="flex-[2] px-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Function URL</div>
          <div className="flex-1 px-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Next Run</div>
          <div className="flex-1 px-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Last Run</div>
          <div className="flex-1 px-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Created</div>
          <div className="w-[60px] px-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Active</div>
          <div className="w-12" />
        </div>

        {/* Table Body */}
        <div className="flex flex-col pb-4">
          {isLoading ? (
            <>
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-12 rounded-none border-b border-[var(--alpha-8)] bg-[rgb(var(--card))]" />
              ))}
            </>
          ) : filteredSchedules.length >= 1 ? (
            <>
              {filteredSchedules.map((s, index) => (
                <ScheduleRow
                  key={s.id}
                  schedule={s}
                  onClick={() => void handleViewLogs(s.id, s.name)}
                  onEdit={(id) => handleEditSchedule(id)}
                  onDelete={(id) => void handleDeleteSchedule(id)}
                  onToggle={(id, isActive) => void toggleScheduleFn(id, isActive)}
                  isLoading={Boolean(isUpdating || isDeletingSchedule)}
                  isLast={index === filteredSchedules.length - 1}
                />
              ))}
            </>
          ) : (
            <ScheduleEmptyState />
          )}
        </div>

        {/* Pagination controls */}
        {totalPages > 1 && (
          <div className="flex items-center justify-end gap-2 px-3 py-2">
            <Button
              variant="ghost"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="text-muted-foreground hover:text-foreground"
            >
              Prev
            </Button>
            <div className="text-sm text-muted-foreground">
              Page {currentPage} of {totalPages}
            </div>
            <Button
              variant="ghost"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="text-muted-foreground hover:text-foreground"
            >
              Next
            </Button>
          </div>
        )}

        {/* Loading mask overlay */}
        {isRefreshing && (
          <div className="absolute inset-0 bg-[rgb(var(--semantic-1))] flex items-center justify-center z-50">
            <div className="flex items-center gap-1">
              <div className="w-5 h-5 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-muted-foreground">Loading</span>
            </div>
          </div>
        )}
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

      <ConfirmDialog {...confirmDialogProps} />
    </div>
  );
}
