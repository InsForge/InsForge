import { z } from 'zod';
// The import remains the same, but it now brings in the camelCased schema
import { scheduleSchema } from './schedules.schema';

/**
 * Schema for the input of the upsert (create/update) schedule endpoint.
 * Properties are camelCased as per API convention.
 */
export const upsertScheduleRequestSchema = z.object({
  id: z
    .string()
    .uuid()
    .optional()
    .describe('The UUID of the schedule to update. If omitted, a new schedule will be created.'),
  name: z.string().min(3, 'Schedule name must be at least 3 characters long'),
  cronSchedule: z.string().refine(
    (value) => {
      const parts = value.split(' ');
      return parts.length === 5 || parts.length === 6;
    },
    { message: 'Invalid cron schedule format. Use 5 or 6 parts (e.g., "* * * * *").' }
  ),
  functionUrl: z.string().url('The function URL must be a valid URL.'),
  httpMethod: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('POST'),
  headers: z
    .record(z.string())
    .optional()
    .describe('Header values starting with "secret:" will be resolved from the secrets store.'),
  body: z.record(z.unknown()).optional().describe('The JSON body to send with the request.'),
});

/**
 * Schema for the response when listing all schedules.
 */
export const listSchedulesResponseSchema = z.array(scheduleSchema);

/**
 * Schema for the response when getting a single schedule.
 */
export const getScheduleResponseSchema = scheduleSchema;

/**
 * Schema for the response of a successful upsert operation.
 */
export const upsertScheduleResponseSchema = z.object({
  id: z.string().uuid(),
  cronJobId: z.string(),
  message: z.string(),
});

/**
 * Schema for the response of a successful delete operation.
 */
export const deleteScheduleResponseSchema = z.object({
  message: z.string(),
});

export type UpsertScheduleRequest = z.infer<typeof upsertScheduleRequestSchema>;
export type ListSchedulesResponse = z.infer<typeof listSchedulesResponseSchema>;
export type GetScheduleResponse = z.infer<typeof getScheduleResponseSchema>;
export type UpsertScheduleResponse = z.infer<typeof upsertScheduleResponseSchema>;
export type DeleteScheduleResponse = z.infer<typeof deleteScheduleResponseSchema>;
