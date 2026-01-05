import { z } from 'zod';

// MCP Usage Record
export const mcpUsageRecordSchema = z.object({
  toolName: z.string(),
  success: z.boolean(),
  createdAt: z.string(),
});

// AI Usage by Model (for stats)
export const aiUsageByModelSchema = z.object({
  model: z.string(),
  totalInputTokens: z.number(),
  totalOutputTokens: z.number(),
  totalImages: z.number(),
});

// Usage Statistics
export const usageStatsSchema = z.object({
  mcpUsageCount: z.number(),
  databaseSizeBytes: z.number(),
  storageSizeBytes: z.number(),
  aiUsageByModel: z.array(aiUsageByModelSchema),
});

export type McpUsageRecord = z.infer<typeof mcpUsageRecordSchema>;
export type AIUsageByModel = z.infer<typeof aiUsageByModelSchema>;
export type UsageStats = z.infer<typeof usageStatsSchema>;
