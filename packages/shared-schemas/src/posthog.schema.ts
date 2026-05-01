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

// v2.5 dashboard ----------------------------------------------------------

export const posthogTimeframeSchema = z.enum(['24h', '7d', '30d', '3m']);
export type PosthogTimeframe = z.infer<typeof posthogTimeframeSchema>;

export const posthogWebOverviewItemSchema = z.object({
  key: z.string(),
  value: z.number().nullable(),
  previous: z.number().nullable(),
  changeFromPreviousPct: z.number().nullable(),
  isIncreaseBad: z.boolean().nullable().optional(),
});
export type PosthogWebOverviewItem = z.infer<typeof posthogWebOverviewItemSchema>;

export const posthogWebOverviewResponseSchema = z.object({
  items: z.array(posthogWebOverviewItemSchema),
});
export type PosthogWebOverviewResponse = z.infer<typeof posthogWebOverviewResponseSchema>;

export const posthogWebStatsRowSchema = z.object({
  breakdownValue: z.string().nullable(),
  visitors: z.number(),
  views: z.number(),
  uiFillFraction: z.number(),
});
export type PosthogWebStatsRow = z.infer<typeof posthogWebStatsRowSchema>;

export const posthogWebStatsResponseSchema = z.object({
  rows: z.array(posthogWebStatsRowSchema),
});
export type PosthogWebStatsResponse = z.infer<typeof posthogWebStatsResponseSchema>;

export const posthogTrendPointSchema = z.object({
  date: z.string(),
  count: z.number(),
});
export type PosthogTrendPoint = z.infer<typeof posthogTrendPointSchema>;

export const posthogTrendsResponseSchema = z.object({
  series: z.array(posthogTrendPointSchema),
});
export type PosthogTrendsResponse = z.infer<typeof posthogTrendsResponseSchema>;

export const posthogRetentionRowSchema = z.object({
  date: z.string(),
  label: z.string(),
  values: z.array(z.object({ count: z.number().nullable() })),
});
export type PosthogRetentionRow = z.infer<typeof posthogRetentionRowSchema>;

export const posthogRetentionResponseSchema = z.object({
  rows: z.array(posthogRetentionRowSchema),
});
export type PosthogRetentionResponse = z.infer<typeof posthogRetentionResponseSchema>;

export const posthogRecordingItemSchema = z.object({
  id: z.string(),
  distinctId: z.string(),
  durationSeconds: z.number(),
  startTime: z.string(),
  endTime: z.string(),
  startUrl: z.string().nullable(),
  clickCount: z.number(),
  consoleErrorCount: z.number(),
});
export type PosthogRecordingItem = z.infer<typeof posthogRecordingItemSchema>;

export const posthogRecordingsResponseSchema = z.object({
  items: z.array(posthogRecordingItemSchema),
});
export type PosthogRecordingsResponse = z.infer<typeof posthogRecordingsResponseSchema>;

export const posthogShareTokenResponseSchema = z.object({
  embedUrl: z.string().url(),
});
export type PosthogShareTokenResponse = z.infer<typeof posthogShareTokenResponseSchema>;
