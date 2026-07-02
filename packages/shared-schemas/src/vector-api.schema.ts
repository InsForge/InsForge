import { z } from 'zod';

// ============================================================================
// Vector store contracts (Pinecone-like, backed by pgvector).
// A collection groups items of a fixed embedding dimension; items carry an
// embedding plus optional source text and JSON metadata. Items are owner-scoped
// via RLS for end users; the project API key operates on the project-global
// store (owner_id = NULL).
// ============================================================================

// MVP indexes cosine with HNSW. 'l2' / 'ip' are accepted and computed correctly
// but are not index-accelerated yet (sequential scan) — see vector docs.
export const vectorMetricSchema = z.enum(['cosine', 'l2', 'ip']);
export type VectorMetric = z.infer<typeof vectorMetricSchema>;

// Fixed in the MVP to match the managed embedding model (text-embedding-3-small).
// Stored per-collection so a future per-collection-table backend can vary it.
export const VECTOR_DEFAULT_DIMENSION = 1536;

const collectionNameSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/, 'Collection name must be alphanumeric, "_" or "-"');

export const vectorCollectionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  dimension: z.number().int().positive(),
  metric: vectorMetricSchema,
  createdAt: z.string(),
});
export type VectorCollection = z.infer<typeof vectorCollectionSchema>;

// POST /api/vectors/collections
export const createCollectionRequestSchema = z.object({
  name: collectionNameSchema,
  dimension: z.number().int().positive().max(2000).default(VECTOR_DEFAULT_DIMENSION),
  metric: vectorMetricSchema.default('cosine'),
});
export type CreateCollectionRequest = z.infer<typeof createCollectionRequestSchema>;

export const listCollectionsResponseSchema = z.object({
  collections: z.array(vectorCollectionSchema),
});
export type ListCollectionsResponse = z.infer<typeof listCollectionsResponseSchema>;

// A single item to upsert. Provide either `vector` (bring-your-own embedding)
// or `content` (auto-embedded server-side via the Model Gateway). `id` lets the
// caller make upserts idempotent; omitted means insert with a generated id.
export const vectorUpsertItemSchema = z
  .object({
    id: z.string().uuid().optional(),
    vector: z.array(z.number()).min(1).optional(),
    content: z.string().min(1).max(20_000).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .refine((v) => Boolean(v.vector) || Boolean(v.content), {
    message: 'Provide either { vector } or { content }',
  });
export type VectorUpsertItem = z.infer<typeof vectorUpsertItemSchema>;

// POST /api/vectors/collections/:name/upsert
export const vectorUpsertRequestSchema = z.object({
  items: z.array(vectorUpsertItemSchema).min(1).max(100),
});
export type VectorUpsertRequest = z.infer<typeof vectorUpsertRequestSchema>;

export const vectorUpsertResponseSchema = z.object({
  ids: z.array(z.string().uuid()),
});
export type VectorUpsertResponse = z.infer<typeof vectorUpsertResponseSchema>;

// POST /api/vectors/collections/:name/query
export const vectorQueryRequestSchema = z
  .object({
    vector: z.array(z.number()).min(1).optional(),
    text: z.string().min(1).max(4_000).optional(),
    topK: z.number().int().positive().max(100).default(10),
    // Pinecone-style metadata filter, matched with the jsonb containment (@>) op.
    filter: z.record(z.unknown()).optional(),
    includeContent: z.boolean().default(true),
  })
  .refine((v) => Boolean(v.vector) || Boolean(v.text), {
    message: 'Provide either { vector } or { text }',
  });
export type VectorQueryRequest = z.infer<typeof vectorQueryRequestSchema>;

export const vectorMatchSchema = z.object({
  id: z.string().uuid(),
  score: z.number(),
  content: z.string().nullable(),
  metadata: z.record(z.unknown()),
});
export type VectorMatch = z.infer<typeof vectorMatchSchema>;

export const vectorQueryResponseSchema = z.object({
  matches: z.array(vectorMatchSchema),
});
export type VectorQueryResponse = z.infer<typeof vectorQueryResponseSchema>;
