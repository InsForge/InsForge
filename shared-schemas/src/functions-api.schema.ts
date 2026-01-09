import { z } from 'zod';
import { functionSchema } from './functions.schema';

export const uploadFunctionRequestSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  slug: z
    .string()
    .regex(
      /^[a-zA-Z0-9_-]+$/,
      'Invalid slug format - must be alphanumeric with hyphens or underscores only'
    )
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
});

export type UploadFunctionRequest = z.infer<typeof uploadFunctionRequestSchema>;
export type UpdateFunctionRequest = z.infer<typeof updateFunctionRequestSchema>;
export type ListFunctionsResponse = z.infer<typeof listFunctionsResponseSchema>;
