import { apiClient } from '@/lib/api/client';
import type { ScheduleRow } from '@/features/functions/types/schedules';
import {
  listSchedulesResponseSchema,
  getScheduleResponseSchema,
  upsertScheduleResponseSchema,
  listExecutionLogsResponseSchema,
  deleteScheduleResponseSchema,
} from '@insforge/shared-schemas';

export interface UpsertScheduleInput {
  id?: string;
  name: string;
  cronSchedule: string;
  functionUrl: string;
  httpMethod: string;
  headers?: Record<string, string>;
  body?: Record<string, unknown> | string;
}

export interface UpsertScheduleResponse {
  id: string;
  cronJobId?: string | null;
  message: string;
}

export interface ToggleScheduleResponse {
  message: string;
}

export class ScheduleService {
  async listSchedules(): Promise<ScheduleRow[]> {
    const resp = await apiClient.request('/schedules', {
      headers: apiClient.withAccessToken(),
    });

    const parsed = listSchedulesResponseSchema.safeParse(resp);
    if (!parsed.success) {
      throw new Error(
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')
      );
    }
    return parsed.data as ScheduleRow[];
  }

  async getSchedule(id: string): Promise<ScheduleRow | null> {
    const resp = await apiClient.request(`/schedules/${encodeURIComponent(id)}`, {
      headers: apiClient.withAccessToken(),
    });
    const parsed = getScheduleResponseSchema.safeParse(resp);
    if (!parsed.success) {
      throw new Error(
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')
      );
    }
    return parsed.data as ScheduleRow;
  }

  async upsertSchedule(payload: UpsertScheduleInput): Promise<UpsertScheduleResponse> {
    const resp = await apiClient.request('/schedules', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...apiClient.withAccessToken(),
      },
      body: JSON.stringify(payload),
    });

    const parsed = upsertScheduleResponseSchema.safeParse(resp);
    if (!parsed.success) {
      throw new Error(
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')
      );
    }
    return parsed.data;
  }

  async toggleSchedule(scheduleId: string, isActive: boolean): Promise<ToggleScheduleResponse> {
    const resp = await apiClient.request(`/schedules/${encodeURIComponent(scheduleId)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...apiClient.withAccessToken(),
      },
      body: JSON.stringify({ isActive }),
    });

    if (!resp || typeof resp.message !== 'string') {
      throw new Error('Invalid response from toggle schedule');
    }
    return { message: resp.message };
  }

  async deleteSchedule(scheduleId: string): Promise<{ message: string }> {
    const resp = await apiClient.request(`/schedules/${encodeURIComponent(scheduleId)}`, {
      method: 'DELETE',
      headers: apiClient.withAccessToken(),
    });
    const parsed = deleteScheduleResponseSchema.safeParse(resp);
    if (!parsed.success) {
      throw new Error(
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')
      );
    }
    return parsed.data;
  }

  async listExecutionLogs(scheduleId: string, limit = 50, offset = 0) {
    const resp = await apiClient.request(
      `/schedules/${encodeURIComponent(scheduleId)}/logs?limit=${limit}&offset=${offset}`,
      {
        headers: apiClient.withAccessToken(),
      }
    );
    const parsed = listExecutionLogsResponseSchema.safeParse(resp);
    if (!parsed.success) {
      throw new Error(
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')
      );
    }
    return parsed.data;
  }
}

export const scheduleService = new ScheduleService();
