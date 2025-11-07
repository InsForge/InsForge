import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Schedule, ScheduleRow } from '@/features/functions/components/CronJobsContent.js';

const SCHEDULES_QUERY_KEY = ['schedules'];

// Mock service - will be replaced with actual API calls
const mockSchedules: Schedule[] = [
  {
    id: 'cb8d967d-28f2-4049-8f23-2b6d8518f31f',
    name: 'Initial Schedule',
    cronSchedule: '* * * * *',
    functionUrl: 'http://insforge:7130/functions/add-numbers',
    httpMethod: 'POST',
    cronJobId: '1',
    createdAt: '2025-10-20T14:12:55.687Z',
    updatedAt: '2025-10-20T14:12:55.687Z',
    lastExecutedAt: '2025-11-07T10:32:00.000Z',
    isActive: true,
  },
];

export function useSchedules() {
  return useQuery({
    queryKey: SCHEDULES_QUERY_KEY,
    queryFn: async () => {
      // TODO: Replace with actual API call
      // const response = await scheduleService.listSchedules();
      return mockSchedules.map((schedule) => ({
        ...schedule,
        isActive: schedule.cronJobId !== null,
      })) as ScheduleRow[];
    },
  });
}

export function useToggleScheduleStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ scheduleId, isActive }: { scheduleId: string; isActive: boolean }) => {
      // TODO: Replace with actual API call
      // return scheduleService.toggleScheduleStatus(scheduleId, isActive);
      console.log('Toggle schedule:', scheduleId, isActive);
      return { success: true };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SCHEDULES_QUERY_KEY });
    },
  });
}

export function useDeleteSchedule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (scheduleId: string) => {
      // TODO: Replace with actual API call
      // return scheduleService.deleteSchedule(scheduleId);
      console.log('Delete schedule:', scheduleId);
      return { success: true };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SCHEDULES_QUERY_KEY });
    },
  });
}
