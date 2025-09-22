import { z } from 'zod';

// Core schemas
export const modalitySchema = z.enum(['text', 'image', 'audio', 'video', 'file']);

export const aiConfigurationSchema = z.object({
  id: z.string().uuid(),
  inputModality: z.array(modalitySchema).min(1),
  outputModality: z.array(modalitySchema).min(1),
  provider: z.string(),
  modelId: z.string(),
  systemPrompt: z.string().optional(),
});

export const aiConfigurationWithUsageSchema = aiConfigurationSchema.extend({
  usageStats: z
    .object({
      totalInputTokens: z.number(),
      totalOutputTokens: z.number(),
      totalTokens: z.number(),
      totalImageCount: z.number(),
      totalRequests: z.number(),
    })
    .optional(),
});

export const aiUsageDataSchema = z.object({
  configId: z.string().uuid(),
  inputTokens: z.number().int().optional(),
  outputTokens: z.number().int().optional(),
  imageCount: z.number().int().optional(),
  imageResolution: z.string().optional(),
});

export const aiUsageRecordSchema = aiUsageDataSchema.extend({
  id: z.string().uuid(),
  createdAt: z.date(),
});

export const aiUsageSummarySchema = z.object({
  totalInputTokens: z.number(),
  totalOutputTokens: z.number(),
  totalTokens: z.number(),
  totalImageCount: z.number(),
  totalRequests: z.number(),
});

// Export types
export type ModalitySchema = z.infer<typeof modalitySchema>;
export type AIConfigurationSchema = z.infer<typeof aiConfigurationSchema>;
export type AIConfigurationWithUsageSchema = z.infer<typeof aiConfigurationWithUsageSchema>;
export type AIUsageDataSchema = z.infer<typeof aiUsageDataSchema>;
export type AIUsageRecordSchema = z.infer<typeof aiUsageRecordSchema>;
export type AIUsageSummarySchema = z.infer<typeof aiUsageSummarySchema>;
