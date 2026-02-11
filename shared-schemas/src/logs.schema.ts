import { z } from 'zod';

// Audit log schemas
export const auditLogSchema = z.object({
  id: z.string(),
  actor: z.string(),
  action: z.string(),
  module: z.string(),
  details: z.record(z.unknown()).nullable(),
  ipAddress: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type AuditLogSchema = z.infer<typeof auditLogSchema>;

// System log schemas
export const logSourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  token: z.string(),
});

export const logSchema = z.object({
  id: z.string(),
  eventMessage: z.string(),
  timestamp: z.string(),
  body: z.record(z.string(), z.unknown()),
  source: z.string().optional(),
});

export const logStatsSchema = z.object({
  source: z.string(),
  count: z.number(),
  lastActivity: z.string(),
});

export type LogSourceSchema = z.infer<typeof logSourceSchema>;
export type LogSchema = z.infer<typeof logSchema>;
export type LogStatsSchema = z.infer<typeof logStatsSchema>;

// Build log schemas (for function deployment logs)
export const buildLogEntrySchema = z.object({
  level: z.string(),
  message: z.string(),
});

export const getBuildLogsResponseSchema = z.object({
  deploymentId: z.string(),
  status: z.enum(['pending', 'success', 'failed']),
  logs: z.array(buildLogEntrySchema),
  createdAt: z.string(),
});

export type BuildLogEntrySchema = z.infer<typeof buildLogEntrySchema>;
export type GetBuildLogsResponseSchema = z.infer<typeof getBuildLogsResponseSchema>;
