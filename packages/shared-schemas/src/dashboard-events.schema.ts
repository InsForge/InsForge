import { z } from 'zod';

export const dashboardDataUpdateResourceSchema = z.enum([
  'database',
  'users',
  'buckets',
  'functions',
  'deployments',
  'compute_services',
]);

export const dashboardDatabaseResourceUpdateSchema = z.object({
  type: z.enum([
    'tables',
    'table',
    'records',
    'index',
    'trigger',
    'policy',
    'function',
    'extension',
    'migration',
  ]),
  name: z.string().optional(),
});

export const dashboardDataUpdateEventSchema = z.object({
  type: z.literal('data-update'),
  resource: dashboardDataUpdateResourceSchema,
  data: z
    .object({
      changes: z.array(dashboardDatabaseResourceUpdateSchema).optional(),
      slug: z.string().optional(),
      bucketName: z.string().optional(),
    })
    .optional(),
});

export const dashboardMcpConnectedEventSchema = z.object({
  type: z.literal('mcp-connected'),
  toolName: z.string().min(1),
  createdAt: z.string().datetime(),
});

export const dashboardReadyEventSchema = z.object({
  type: z.literal('ready'),
});

export const dashboardEventSchema = z.discriminatedUnion('type', [
  dashboardDataUpdateEventSchema,
  dashboardMcpConnectedEventSchema,
  dashboardReadyEventSchema,
]);

export type DashboardDataUpdateResource = z.infer<typeof dashboardDataUpdateResourceSchema>;
export type DashboardDatabaseResourceUpdate = z.infer<typeof dashboardDatabaseResourceUpdateSchema>;
export type DashboardDataUpdateEvent = z.infer<typeof dashboardDataUpdateEventSchema>;
export type DashboardMcpConnectedEvent = z.infer<typeof dashboardMcpConnectedEventSchema>;
export type DashboardEvent = z.infer<typeof dashboardEventSchema>;
