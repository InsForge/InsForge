import { z } from 'zod';

export const posthogConnectionStatusSchema = z.enum(['active', 'degraded', 'revoked']);
export type PosthogConnectionStatus = z.infer<typeof posthogConnectionStatusSchema>;

export const posthogConnectionSchema = z.object({
  posthogProjectId: z.string(),
  organizationName: z.string().nullable(),
  projectName: z.string(),
  region: z.enum(['US', 'EU']),
  host: z.string().url(),
  apiKey: z.string(),
  status: posthogConnectionStatusSchema,
  createdAt: z.string(),
});
export type PosthogConnection = z.infer<typeof posthogConnectionSchema>;

export const posthogDashboardSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string().optional(),
  pinned: z.boolean().optional(),
  lastModifiedAt: z.string().optional(),
  url: z.string().url(),
});
export type PosthogDashboard = z.infer<typeof posthogDashboardSchema>;

export const posthogDashboardsResponseSchema = z.object({
  dashboards: z.array(posthogDashboardSchema),
  count: z.number(),
});
export type PosthogDashboardsResponse = z.infer<typeof posthogDashboardsResponseSchema>;

export const posthogSummarySchema = z.object({
  todayEvents: z.number(),
  dau24h: z.number(),
  totalEvents7d: z.number(),
  topEvents: z.array(z.object({ event: z.string(), count: z.number() })),
});
export type PosthogSummary = z.infer<typeof posthogSummarySchema>;

export const posthogEventRecordSchema = z.object({
  id: z.string(),
  event: z.string(),
  distinctId: z.string(),
  timestamp: z.string(),
});
export type PosthogEventRecord = z.infer<typeof posthogEventRecordSchema>;

export const posthogEventsResponseSchema = z.object({
  events: z.array(posthogEventRecordSchema),
  next: z.string().nullable(),
});
export type PosthogEventsResponse = z.infer<typeof posthogEventsResponseSchema>;
