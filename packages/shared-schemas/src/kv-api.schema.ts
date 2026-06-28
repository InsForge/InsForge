import { z } from 'zod';

// ============================================================================
// Key-Value store contracts (shared across backend, SDK, CLI, dashboard).
// A KV entry is arbitrary JSON addressed by (namespace, key). Entries are
// owner-scoped via RLS for end users; the project API key operates on the
// shared project-global store (owner_id = NULL).
// ============================================================================

// Visibility maps onto RLS: 'private' = owner only, 'authed' = any signed-in
// user can read, 'public' = anon can read. Writes are always owner-only.
export const kvVisibilitySchema = z.enum(['private', 'authed', 'public']);
export type KvVisibility = z.infer<typeof kvVisibilitySchema>;

// Namespaces and keys are single URL path segments. ':' is allowed (the
// conventional namespace separator inside a key); '/' is not.
const namespaceSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[^/]+$/, 'Namespace must not contain "/"');
const keySchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[^/]+$/, 'Key must not contain "/"');

// Stored values are arbitrary JSON. z.unknown() keeps the contract honest:
// the backend enforces the byte-size cap, not a shape.
export const kvValueSchema = z.unknown();

// TTL in seconds. null = never expires. Omitted = server default (30 days).
const ttlSecondsSchema = z
  .number()
  .int()
  .positive()
  .max(60 * 60 * 24 * 365 * 10);

export const kvEntrySchema = z.object({
  namespace: z.string(),
  key: z.string(),
  value: kvValueSchema,
  visibility: kvVisibilitySchema,
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type KvEntry = z.infer<typeof kvEntrySchema>;

// PUT /api/kv/entries/:namespace/:key
export const kvSetRequestSchema = z.object({
  value: kvValueSchema,
  ttl: ttlSecondsSchema.nullable().optional(),
  visibility: kvVisibilitySchema.optional(),
  // set-if-not-exists; returns created=false on conflict instead of overwriting
  ifNotExists: z.boolean().optional(),
});
export type KvSetRequest = z.infer<typeof kvSetRequestSchema>;

export const kvSetResponseSchema = z.object({
  created: z.boolean(),
  entry: kvEntrySchema.nullable(),
});
export type KvSetResponse = z.infer<typeof kvSetResponseSchema>;

// POST /api/kv/entries/:namespace/:key/incr  (and /decr)
export const kvIncrRequestSchema = z.object({
  by: z.number().default(1),
  ttl: ttlSecondsSchema.nullable().optional(),
});
export type KvIncrRequest = z.infer<typeof kvIncrRequestSchema>;

export const kvIncrResponseSchema = z.object({ value: z.number() });
export type KvIncrResponse = z.infer<typeof kvIncrResponseSchema>;

// POST /api/kv/entries/:namespace/:key/cas
export const kvCasRequestSchema = z.object({
  expected: kvValueSchema,
  next: kvValueSchema,
  ttl: ttlSecondsSchema.nullable().optional(),
});
export type KvCasRequest = z.infer<typeof kvCasRequestSchema>;

// POST /api/kv/entries/:namespace/:key/expire
export const kvExpireRequestSchema = z.object({
  ttl: ttlSecondsSchema.nullable(),
});
export type KvExpireRequest = z.infer<typeof kvExpireRequestSchema>;

export const kvTtlResponseSchema = z.object({ ttl: z.number().nullable() });
export type KvTtlResponse = z.infer<typeof kvTtlResponseSchema>;

// POST /api/kv/mget
export const kvMgetRequestSchema = z.object({
  namespace: namespaceSchema.default('default'),
  keys: z.array(keySchema).min(1).max(100),
});
export type KvMgetRequest = z.infer<typeof kvMgetRequestSchema>;

export const kvMgetResponseSchema = z.object({
  // map of key -> value (missing/expired keys are omitted)
  values: z.record(kvValueSchema),
});
export type KvMgetResponse = z.infer<typeof kvMgetResponseSchema>;

// POST /api/kv/mset
export const kvMsetRequestSchema = z.object({
  namespace: namespaceSchema.default('default'),
  entries: z.record(kvValueSchema),
  ttl: ttlSecondsSchema.nullable().optional(),
  visibility: kvVisibilitySchema.optional(),
});
export type KvMsetRequest = z.infer<typeof kvMsetRequestSchema>;

export const kvMsetResponseSchema = z.object({ count: z.number() });
export type KvMsetResponse = z.infer<typeof kvMsetResponseSchema>;

// GET /api/kv/entries/:namespace  (list keys in a namespace)
export const kvListResponseSchema = z.object({
  keys: z.array(
    z.object({
      key: z.string(),
      visibility: kvVisibilitySchema,
      expiresAt: z.string().nullable(),
      updatedAt: z.string(),
    })
  ),
});
export type KvListResponse = z.infer<typeof kvListResponseSchema>;
