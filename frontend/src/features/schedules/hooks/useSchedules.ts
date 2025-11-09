import { useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ScheduleRow } from '@/features/functions/types/schedules';
import {
  scheduleService,
  type UpsertScheduleInput,
  type UpsertScheduleResponse,
} from '@/features/schedules/services/schedule.service';
import { useToast } from '@/lib/hooks/useToast';

const SCHEDULES_QUERY_KEY = ['schedules'];

export function useSchedules() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [errorState, setErrorState] = useState<Error | null>(null);

  const {
    data: allSchedules = [],
    isLoading,
    error,
    refetch,
  } = useQuery<ScheduleRow[]>({
    queryKey: SCHEDULES_QUERY_KEY,
    queryFn: () => scheduleService.listSchedules(),
    staleTime: 2 * 60 * 1000,
  });

  // Keep a unified error state combining query errors and mutation errors
  useEffect(() => {
    if (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      setErrorState(err);
    } else {
      setErrorState(null);
    }
  }, [error]);

  const schedules = allSchedules;

  const upsertMutation = useMutation<UpsertScheduleResponse, Error, UpsertScheduleInput>({
    mutationFn: (payload: UpsertScheduleInput) => scheduleService.upsertSchedule(payload),
    onSuccess: () => {
      setErrorState(null);
      showToast('Cron job saved', 'success');
      void queryClient.invalidateQueries({ queryKey: SCHEDULES_QUERY_KEY });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err ?? 'Failed to save cron job');
      setErrorState(err instanceof Error ? err : new Error(msg));
      showToast(msg, 'error');
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ scheduleId, isActive }: { scheduleId: string; isActive: boolean }) =>
      scheduleService.toggleSchedule(scheduleId, isActive),
    onMutate: async ({ scheduleId, isActive }: { scheduleId: string; isActive: boolean }) => {
      await queryClient.cancelQueries({ queryKey: SCHEDULES_QUERY_KEY });
      const previous = queryClient.getQueryData<ScheduleRow[]>(SCHEDULES_QUERY_KEY);
      queryClient.setQueryData<ScheduleRow[] | undefined>(SCHEDULES_QUERY_KEY, (old) =>
        old?.map((s) => (s.id === scheduleId ? { ...s, isActive } : s))
      );
      return { previous } as { previous?: ScheduleRow[] };
    },
    onError: (err: unknown, _variables, context: unknown) => {
      const ctx = context as { previous?: ScheduleRow[] } | undefined;
      if (ctx?.previous) {
        queryClient.setQueryData(SCHEDULES_QUERY_KEY, ctx.previous);
      }
      setErrorState(err instanceof Error ? err : new Error(String(err ?? 'Toggle failed')));
      const msg = err instanceof Error ? err.message : String(err ?? 'Toggle failed');
      showToast(msg, 'error');
    },
    onSuccess: () => {
      setErrorState(null);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: SCHEDULES_QUERY_KEY });
    },
  });

  const deleteMutation = useMutation<{ message: string }, Error, string>({
    mutationFn: (scheduleId: string) => scheduleService.deleteSchedule(scheduleId),
    onMutate: async (scheduleId: string) => {
      await queryClient.cancelQueries({ queryKey: SCHEDULES_QUERY_KEY });
      const previous = queryClient.getQueryData<ScheduleRow[]>(SCHEDULES_QUERY_KEY);
      queryClient.setQueryData<ScheduleRow[] | undefined>(SCHEDULES_QUERY_KEY, (old) =>
        old?.filter((s) => s.id !== scheduleId)
      );
      return { previous } as { previous?: ScheduleRow[] };
    },
    onError: (err: unknown, _variables, context: unknown) => {
      const ctx = context as { previous?: ScheduleRow[] } | undefined;
      if (ctx?.previous) {
        queryClient.setQueryData(SCHEDULES_QUERY_KEY, ctx.previous);
      }
      setErrorState(err instanceof Error ? err : new Error(String(err ?? 'Delete failed')));
      const msg = err instanceof Error ? err.message : String(err ?? 'Delete failed');
      showToast(msg, 'error');
    },
    onSuccess: () => {
      setErrorState(null);
      showToast('Cron job deleted', 'success');
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: SCHEDULES_QUERY_KEY });
    },
  });

  const createOrUpdate = useCallback(
    async (payload: UpsertScheduleInput) => {
      try {
        await upsertMutation.mutateAsync(payload);
        return true;
      } catch (err: unknown) {
        setErrorState(err instanceof Error ? err : new Error(String(err ?? 'Save failed')));
        return false;
      }
    },
    [upsertMutation]
  );

  const deleteSchedule = useCallback(
    async (scheduleId: string) => {
      try {
        await deleteMutation.mutateAsync(scheduleId);
        return true;
      } catch (err: unknown) {
        setErrorState(err instanceof Error ? err : new Error(String(err ?? 'Delete failed')));
        return false;
      }
    },
    [deleteMutation]
  );

  const toggleSchedule = useCallback(
    async (scheduleId: string, isActive: boolean) => {
      try {
        await toggleMutation.mutateAsync({ scheduleId, isActive });
        return true;
      } catch (err: unknown) {
        setErrorState(err instanceof Error ? err : new Error(String(err ?? 'Toggle failed')));
        return false;
      }
    },
    [toggleMutation]
  );

  const getSchedule = useCallback(async (scheduleId: string) => {
    if (!scheduleId) {
      return null;
    }
    return scheduleService.getSchedule(scheduleId);
  }, []);

  const listExecutionLogs = useCallback(async (scheduleId: string, limit = 50, offset = 0) => {
    return scheduleService.listExecutionLogs(scheduleId, limit, offset);
  }, []);

  const filteredSchedules = schedules.filter((s: ScheduleRow) =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return {
    // Data
    schedules,
    filteredSchedules,
    schedulesCount: schedules.length,
    searchQuery,

    // Loading states
    isLoading,
    isCreating: upsertMutation.isPending,
    isDeleting: deleteMutation.isPending,
    isToggling: toggleMutation.isPending,

    // Error
    error: errorState,

    // Actions
    createOrUpdate,
    deleteSchedule,
    toggleSchedule,
    getSchedule,
    listExecutionLogs,
    setSearchQuery,
    refetch,

    // Confirm dialog props
  };
}
