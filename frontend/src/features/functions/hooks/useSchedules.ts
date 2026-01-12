import { useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  ScheduleSchema,
  CreateScheduleRequest,
  CreateScheduleResponse,
  UpdateScheduleRequest,
  UpdateScheduleResponse,
} from '@insforge/shared-schemas';
import { scheduleService } from '@/features/functions/services/schedule.service';
import { useToast } from '@/lib/hooks/useToast';

const SCHEDULES_QUERY_KEY = ['schedules'];
const SCHEDULE_LOGS_QUERY_KEY = ['schedule-logs'];

export function useScheduleLogs(scheduleId: string, limit = 50, offset = 0) {
  return useQuery({
    queryKey: [SCHEDULE_LOGS_QUERY_KEY, scheduleId, limit, offset],
    queryFn: () => scheduleService.listExecutionLogs(scheduleId, limit, offset),
    enabled: !!scheduleId,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });
}

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
  } = useQuery<ScheduleSchema[]>({
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

  const createMutation = useMutation<CreateScheduleResponse, Error, CreateScheduleRequest>({
    mutationFn: (payload: CreateScheduleRequest) => scheduleService.createSchedule(payload),
    onSuccess: () => {
      setErrorState(null);
      showToast('Cron job created', 'success');
      void queryClient.invalidateQueries({ queryKey: SCHEDULES_QUERY_KEY });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err ?? 'Failed to create cron job');
      setErrorState(err instanceof Error ? err : new Error(msg));
      showToast(msg, 'error');
    },
  });

  const updateMutation = useMutation<
    UpdateScheduleResponse,
    Error,
    { scheduleId: string; payload: UpdateScheduleRequest }
  >({
    mutationFn: ({ scheduleId, payload }) => scheduleService.updateSchedule(scheduleId, payload),
    onMutate: async ({ scheduleId, payload }) => {
      // Optimistic update for isActive toggle
      if (payload.isActive !== undefined) {
        const newIsActive = payload.isActive;
        await queryClient.cancelQueries({ queryKey: SCHEDULES_QUERY_KEY });
        const previous = queryClient.getQueryData<ScheduleSchema[]>(SCHEDULES_QUERY_KEY);
        queryClient.setQueryData<ScheduleSchema[] | undefined>(SCHEDULES_QUERY_KEY, (old) =>
          old?.map((s) => (s.id === scheduleId ? { ...s, isActive: newIsActive } : s))
        );
        return { previous } as { previous?: ScheduleSchema[] };
      }
      return {};
    },
    onError: (err: unknown, _variables, context: unknown) => {
      const ctx = context as { previous?: ScheduleSchema[] } | undefined;
      if (ctx?.previous) {
        queryClient.setQueryData(SCHEDULES_QUERY_KEY, ctx.previous);
      }
      setErrorState(
        err instanceof Error ? err : new Error(String(err ?? 'Failed to update cron job'))
      );
      const msg = err instanceof Error ? err.message : String(err ?? 'Failed to update cron job');
      showToast(msg, 'error');
    },
    onSuccess: () => {
      setErrorState(null);
      showToast('Cron job updated', 'success');
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: SCHEDULES_QUERY_KEY });
    },
  });

  const deleteMutation = useMutation<{ message: string }, Error, string>({
    mutationFn: (scheduleId: string) => scheduleService.deleteSchedule(scheduleId),
    onMutate: async (scheduleId: string) => {
      await queryClient.cancelQueries({ queryKey: SCHEDULES_QUERY_KEY });
      const previous = queryClient.getQueryData<ScheduleSchema[]>(SCHEDULES_QUERY_KEY);
      queryClient.setQueryData<ScheduleSchema[] | undefined>(SCHEDULES_QUERY_KEY, (old) =>
        old?.filter((s) => s.id !== scheduleId)
      );
      return { previous } as { previous?: ScheduleSchema[] };
    },
    onError: (err: unknown, _variables, context: unknown) => {
      const ctx = context as { previous?: ScheduleSchema[] } | undefined;
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

  const createSchedule = useCallback(
    async (payload: CreateScheduleRequest) => {
      try {
        await createMutation.mutateAsync(payload);
        return true;
      } catch (err: unknown) {
        setErrorState(err instanceof Error ? err : new Error(String(err ?? 'Create failed')));
        return false;
      }
    },
    [createMutation]
  );

  const updateSchedule = useCallback(
    async (scheduleId: string, payload: UpdateScheduleRequest) => {
      try {
        await updateMutation.mutateAsync({ scheduleId, payload });
        return true;
      } catch (err: unknown) {
        setErrorState(err instanceof Error ? err : new Error(String(err ?? 'Update failed')));
        return false;
      }
    },
    [updateMutation]
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
        await updateMutation.mutateAsync({ scheduleId, payload: { isActive } });
        return true;
      } catch (err: unknown) {
        setErrorState(err instanceof Error ? err : new Error(String(err ?? 'Toggle failed')));
        return false;
      }
    },
    [updateMutation]
  );

  const getSchedule = useCallback(async (scheduleId: string) => {
    if (!scheduleId) {
      return null;
    }
    return scheduleService.getSchedule(scheduleId);
  }, []);

  const filteredSchedules = schedules.filter((s: ScheduleSchema) =>
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
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isSaving: createMutation.isPending || updateMutation.isPending,
    isDeleting: deleteMutation.isPending,

    // Error
    error: errorState,

    // Actions
    createSchedule,
    updateSchedule,
    deleteSchedule,
    toggleSchedule,
    getSchedule,
    setSearchQuery,
    refetch,
  };
}
