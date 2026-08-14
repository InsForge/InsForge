import { z } from 'zod';
import { functionSchema } from './functions.schema.js';

/**
 * Slugs claimed by the generated function router's own built-in routes.
 *
 * The router answers these paths before it dispatches to `routes[slug]`, so a
 * function deployed under one of them deploys successfully but can never be
 * invoked — the built-in handler responds instead, with no error and no
 * warning. Rejecting them at validation turns that silent shadowing into an
 * explicit failure (issue #1862).
 */
export const RESERVED_FUNCTION_SLUGS = ['health'] as const;

export const isReservedFunctionSlug = (slug: string): boolean =>
  (RESERVED_FUNCTION_SLUGS as readonly string[]).includes(slug.toLowerCase());

export const reservedFunctionSlugMessage = `Reserved slug - "${RESERVED_FUNCTION_SLUGS.join('", "')}" ${
  RESERVED_FUNCTION_SLUGS.length === 1 ? 'is' : 'are'
} used by the functions runtime and cannot be used as a function slug`;

export const uploadFunctionRequestSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  slug: z
    .string()
    .regex(
      /^[a-zA-Z0-9_-]+$/,
      'Invalid slug format - must be alphanumeric with hyphens or underscores only'
    )
    .refine((slug) => !isReservedFunctionSlug(slug), reservedFunctionSlugMessage)
    .optional(),
  code: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(['draft', 'active']).optional().default('active'),
});

export const updateFunctionRequestSchema = z.object({
  name: z.string().optional(),
  code: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(['draft', 'active']).optional(),
});

export const listFunctionsResponseSchema = z.object({
  functions: z.array(functionSchema),
  runtime: z.object({
    status: z.enum(['running', 'unavailable']),
  }),
  deploymentUrl: z.string().nullable().optional(),
});

export const deploymentResultSchema = z.object({
  id: z.string(),
  status: z.enum(['success', 'failed']),
  url: z.string().nullable(),
  buildLogs: z.array(z.string()).optional(),
});

export const functionResponseSchema = z.object({
  success: z.boolean(),
  function: functionSchema,
  deployment: deploymentResultSchema.nullable().optional(),
});

export type UploadFunctionRequest = z.infer<typeof uploadFunctionRequestSchema>;
export type UpdateFunctionRequest = z.infer<typeof updateFunctionRequestSchema>;
export type ListFunctionsResponse = z.infer<typeof listFunctionsResponseSchema>;
export type DeploymentResult = z.infer<typeof deploymentResultSchema>;
export type FunctionResponse = z.infer<typeof functionResponseSchema>;
