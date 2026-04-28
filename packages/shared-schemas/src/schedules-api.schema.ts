import { z } from 'zod';
import { scheduleSchema, scheduleLogSchema } from './schedules.schema.js';

// Accept either:
//   - 5-field cron expression (e.g. "*/5 * * * *", "0 9 * * 1-5")
//   - pg_cron sub-minute interval form: "1 second" through "59 seconds"
// Interval form is restricted to seconds because anything ≥ 1 minute is
// already expressible as a 5-field cron expression, and the two semantics
// differ (interval drifts from last run; cron fires on minute boundaries).
const intervalRegex = /^\s*([1-9]|[1-5]\d)\s+seconds?\s*$/i;

const cronScheduleSchema = z.string().refine(
  (value) => {
    if (intervalRegex.test(value)) {
      return true;
    }
    // Service only accepts 5-field cron; 6-field (with seconds prefix) is
    // explicitly rejected, so don't let it past the schema.
    const parts = value.trim().split(/\s+/);
    return parts.length === 5;
  },
  {
    message:
      'Invalid cron schedule. Use 5-field cron (e.g., "*/5 * * * *") or sub-minute interval form (1–59 seconds, e.g., "30 seconds").',
  }
);

/**
 * Schema for creating a new schedule.
 * All fields required except headers and body.
 */
export const createScheduleRequestSchema = z.object({
  name: z.string().min(3, 'Schedule name must be at least 3 characters long'),
  cronSchedule: cronScheduleSchema,
  functionUrl: z.string().url('The function URL must be a valid URL.'),
  httpMethod: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  headers: z
    .record(z.string())
    .optional()
    .describe('Header values can reference secrets using ${{secrets.KEY_NAME}} syntax.'),
  body: z.record(z.unknown()).optional().describe('The JSON body to send with the request.'),
});

/**
 * Schema for updating an existing schedule.
 * All fields optional - supports partial updates including toggling isActive.
 */
export const updateScheduleRequestSchema = z.object({
  name: z.string().min(3, 'Schedule name must be at least 3 characters long').optional(),
  cronSchedule: cronScheduleSchema.optional(),
  functionUrl: z.string().url('The function URL must be a valid URL.').optional(),
  httpMethod: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
  headers: z
    .record(z.string())
    .optional()
    .describe('Header values can reference secrets using ${{secrets.KEY_NAME}} syntax.'),
  body: z.record(z.unknown()).optional().describe('The JSON body to send with the request.'),
  isActive: z.boolean().optional().describe('Enable or disable the schedule.'),
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
 * Schema for a single execution log in the response.
 */
export const executionLogResponseSchema = scheduleLogSchema;

/**
 * Schema for the response when listing execution logs with pagination.
 */
export const listExecutionLogsResponseSchema = z.object({
  logs: z.array(executionLogResponseSchema),
  totalCount: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});

/**
 * Schema for the response of a successful create operation.
 */
export const createScheduleResponseSchema = z.object({
  id: z.string().uuid(),
  cronJobId: z.string(),
  message: z.string(),
});

/**
 * Schema for the response of a successful update operation.
 */
export const updateScheduleResponseSchema = z.object({
  id: z.string().uuid(),
  cronJobId: z.string().optional(),
  message: z.string(),
});

/**
 * Schema for the response of a successful delete operation.
 */
export const deleteScheduleResponseSchema = z.object({
  message: z.string(),
});

export type CreateScheduleRequest = z.infer<typeof createScheduleRequestSchema>;
export type UpdateScheduleRequest = z.infer<typeof updateScheduleRequestSchema>;
export type CreateScheduleResponse = z.infer<typeof createScheduleResponseSchema>;
export type UpdateScheduleResponse = z.infer<typeof updateScheduleResponseSchema>;
export type ListSchedulesResponse = z.infer<typeof listSchedulesResponseSchema>;
export type GetScheduleResponse = z.infer<typeof getScheduleResponseSchema>;
export type ExecutionLogResponse = z.infer<typeof executionLogResponseSchema>;
export type ListExecutionLogsResponse = z.infer<typeof listExecutionLogsResponseSchema>;
export type DeleteScheduleResponse = z.infer<typeof deleteScheduleResponseSchema>;
