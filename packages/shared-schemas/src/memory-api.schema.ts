import { z } from 'zod';

// Kinds of durable agent memory.
export const memoryKindSchema = z.enum(['fact', 'decision', 'preference', 'reference']);
export type MemoryKind = z.infer<typeof memoryKindSchema>;

// POST /api/memory/remember
// Either store a single explicit memory ({ title, content }) or extract many
// durable memories from a raw task transcript ({ transcript }).
export const rememberRequestSchema = z
  .object({
    scope: z.string().min(1).default('default'),
    source: z.string().optional(),
    // explicit single-memory form
    kind: memoryKindSchema.optional(),
    title: z.string().min(1).max(2_000).optional(),
    content: z.string().min(1).max(20_000).optional(),
    // transcript form — capped to bound extraction LLM cost on huge inputs
    transcript: z.string().min(1).max(50_000).optional(),
  })
  .refine((v) => Boolean(v.transcript) || Boolean(v.title && v.content), {
    message: 'Provide either { transcript } or { title, content }',
  });
export type RememberRequest = z.infer<typeof rememberRequestSchema>;

export const reconcileActionSchema = z.enum(['ADD', 'UPDATE', 'NOOP']);
export type ReconcileAction = z.infer<typeof reconcileActionSchema>;

export const rememberResultSchema = z.object({
  action: reconcileActionSchema,
  id: z.string().uuid().optional(),
  title: z.string(),
});
export type RememberResult = z.infer<typeof rememberResultSchema>;

export const rememberResponseSchema = z.object({
  results: z.array(rememberResultSchema),
});
export type RememberResponse = z.infer<typeof rememberResponseSchema>;

// POST /api/memory/recall
export const recallRequestSchema = z.object({
  scope: z.string().min(1).default('default'),
  query: z.string().min(1),
  limit: z.number().int().positive().max(50).default(5),
  threshold: z.number().min(0).max(1).optional(),
});
export type RecallRequest = z.infer<typeof recallRequestSchema>;

export const recalledMemorySchema = z.object({
  id: z.string().uuid(),
  kind: memoryKindSchema,
  title: z.string(),
  content: z.string(),
  similarity: z.number(),
  updated_at: z.string(),
});
export type RecalledMemory = z.infer<typeof recalledMemorySchema>;

export const recallResponseSchema = z.object({
  memories: z.array(recalledMemorySchema),
});
export type RecallResponse = z.infer<typeof recallResponseSchema>;

// POST /api/memory/index — cheap title-only listing (the always-load tier)
export const memoryIndexRequestSchema = z.object({
  scope: z.string().min(1).default('default'),
});
export type MemoryIndexRequest = z.infer<typeof memoryIndexRequestSchema>;

export const memoryIndexEntrySchema = z.object({
  id: z.string().uuid(),
  kind: memoryKindSchema,
  title: z.string(),
  updated_at: z.string(),
});
export type MemoryIndexEntry = z.infer<typeof memoryIndexEntrySchema>;

export const memoryIndexResponseSchema = z.object({
  entries: z.array(memoryIndexEntrySchema),
});
export type MemoryIndexResponse = z.infer<typeof memoryIndexResponseSchema>;
