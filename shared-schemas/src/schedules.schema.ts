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
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Schedule = z.infer<typeof scheduleSchema>;
