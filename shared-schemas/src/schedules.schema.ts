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
  httpMethod: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  // Optional HTTP headers to include when invoking the scheduled function
  headers: z.record(z.string()).nullable(),
  // Body payload for the scheduled invocation. Can be a JSON object or a raw string.
  body: z.union([z.string(), z.record(z.unknown())]).nullable(),
  // cron_job_id is a BIGINT in postgres, which node-pg returns as a string.
  cronJobId: z.string().nullable(),
  lastExecutedAt: z.string().datetime().nullable(),
  // Whether the cron job is currently active (has a scheduled cron job)
  isActive: z.boolean().default(true),
  // Next scheduled run time in ISO format (nullable if cron expression invalid)
  nextRun: z.string().datetime().nullable(),
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
