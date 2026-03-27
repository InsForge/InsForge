import { z } from 'zod';
import { auditLogSchema, logSchema } from './logs.schema';

export const getAuditLogsRequestSchema = z.object({
  limit: z.number().default(100),
  offset: z.number().default(0),
  actor: z.string().optional(),
  action: z.string().optional(),
  module: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export const getAuditLogsResponseSchema = z.object({
  data: z.array(auditLogSchema),
  pagination: z.object({
    limit: z.number(),
    offset: z.number(),
    total: z.number(),
  }),
});

export const getAuditLogStatsRequestSchema = z.object({
  days: z.number().default(7),
});

export const getAuditLogStatsResponseSchema = z.object({
  totalLogs: z.number(),
  uniqueActors: z.number(),
  uniqueModules: z.number(),
  actionsByModule: z.record(z.number()),
  recentActivity: z.array(auditLogSchema),
});

export const clearAuditLogsRequestSchema = z.object({
  daysToKeep: z.number().default(90),
});

export const clearAuditLogsResponseSchema = z.object({
  message: z.string(),
  deleted: z.number(),
});

export const getLogsResponseSchema = z.object({
  logs: z.array(logSchema),
  total: z.number(),
});

export type GetAuditLogsRequest = z.infer<typeof getAuditLogsRequestSchema>;
export type GetAuditLogsResponse = z.infer<typeof getAuditLogsResponseSchema>;
export type GetAuditLogStatsRequest = z.infer<typeof getAuditLogStatsRequestSchema>;
export type GetAuditLogStatsResponse = z.infer<typeof getAuditLogStatsResponseSchema>;
export type ClearAuditLogsRequest = z.infer<typeof clearAuditLogsRequestSchema>;
export type ClearAuditLogsResponse = z.infer<typeof clearAuditLogsResponseSchema>;
export type GetLogsResponse = z.infer<typeof getLogsResponseSchema>;
