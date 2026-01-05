import { z } from 'zod';
import { mcpUsageRecordSchema, usageStatsSchema } from './usage.schema';

// POST /usage/mcp - Record MCP usage
export const recordMcpUsageRequestSchema = z.object({
  toolName: z.string().min(1, 'toolName is required'),
  success: z.boolean().optional().default(true),
});

export const recordMcpUsageResponseSchema = z.object({
  success: z.literal(true),
});

// GET /usage/mcp - Get MCP usage records
export const getMcpUsageRequestSchema = z.object({
  limit: z.coerce.number().optional().default(5),
  success: z.coerce.boolean().optional().default(true),
});

export const getMcpUsageResponseSchema = z.object({
  records: z.array(mcpUsageRecordSchema),
});

// GET /usage/stats - Get usage statistics
export const getUsageStatsRequestSchema = z.object({
  startDate: z.string(),
  endDate: z.string(),
});

export const getUsageStatsResponseSchema = usageStatsSchema;

// Export types
export type RecordMcpUsageRequest = z.infer<typeof recordMcpUsageRequestSchema>;
export type RecordMcpUsageResponse = z.infer<typeof recordMcpUsageResponseSchema>;
export type GetMcpUsageRequest = z.infer<typeof getMcpUsageRequestSchema>;
export type GetMcpUsageResponse = z.infer<typeof getMcpUsageResponseSchema>;
export type GetUsageStatsRequest = z.infer<typeof getUsageStatsRequestSchema>;
export type GetUsageStatsResponse = z.infer<typeof getUsageStatsResponseSchema>;
