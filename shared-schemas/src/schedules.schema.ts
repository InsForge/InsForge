import { z } from 'zod';

/**
 * Represents a single schedule record as stored in the database and
 * used internally within the application.
 * Properties are camelCased to align with TypeScript conventions.
 */
export const scheduleSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  cronSchedule: z.string(),
  functionUrl: z.string().url(),
  httpMethod: z.string(),
  // cron_job_id is a BIGINT in postgres, which node-pg returns as a string.
  cronJobId: z.string().nullable(),
  lastExecutedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const executionLogSchema = z.object({
  id: z.string().uuid(),
  scheduleId: z.string().uuid(),
  executedAt: z.string().datetime(),
  statusCode: z.number().int(),
  success: z.boolean(),
  durationMs: z.number().int(),
  message: z.string().nullable(),
});

export type Schedule = z.infer<typeof scheduleSchema>;
export type ExecutionLog = z.infer<typeof executionLogSchema>;
