import { apiClient } from '@/lib/api/client';
import type {
  ScheduleSchema,
  ListSchedulesResponse,
  ListExecutionLogsResponse,
  CreateScheduleRequest,
  CreateScheduleResponse,
  UpdateScheduleRequest,
  UpdateScheduleResponse,
  DeleteScheduleResponse,
} from '@insforge/shared-schemas';

export class ScheduleService {
  async listSchedules(): Promise<ScheduleSchema[]> {
    const response: ListSchedulesResponse = await apiClient.request('/schedules', {
      headers: apiClient.withAccessToken(),
    });
    return response as ScheduleSchema[];
  }

  async getSchedule(id: string): Promise<ScheduleSchema | null> {
    const response: ScheduleSchema = await apiClient.request(
      `/schedules/${encodeURIComponent(id)}`,
      {
        headers: apiClient.withAccessToken(),
      }
    );
    return response;
  }

  async createSchedule(payload: CreateScheduleRequest): Promise<CreateScheduleResponse> {
    const response: CreateScheduleResponse = await apiClient.request('/schedules', {
      method: 'POST',
      headers: apiClient.withAccessToken(),
      body: JSON.stringify(payload),
    });
    return response;
  }

  async updateSchedule(
    scheduleId: string,
    payload: UpdateScheduleRequest
  ): Promise<UpdateScheduleResponse> {
    const response: UpdateScheduleResponse = await apiClient.request(
      `/schedules/${encodeURIComponent(scheduleId)}`,
      {
        method: 'PATCH',
        headers: apiClient.withAccessToken(),
        body: JSON.stringify(payload),
      }
    );
    return response;
  }

  async deleteSchedule(scheduleId: string): Promise<DeleteScheduleResponse> {
    const response: DeleteScheduleResponse = await apiClient.request(
      `/schedules/${encodeURIComponent(scheduleId)}`,
      {
        method: 'DELETE',
        headers: apiClient.withAccessToken(),
      }
    );
    return response;
  }

  async listExecutionLogs(
    scheduleId: string,
    limit = 50,
    offset = 0
  ): Promise<ListExecutionLogsResponse> {
    const params = new URLSearchParams({
      limit: limit.toString(),
      offset: offset.toString(),
    });

    const response: ListExecutionLogsResponse = await apiClient.request(
      `/schedules/${encodeURIComponent(scheduleId)}/logs?${params.toString()}`,
      {
        headers: apiClient.withAccessToken(),
      }
    );
    return response;
  }
}

export const scheduleService = new ScheduleService();
