import { z } from 'zod';

// Auth policy for function invocation
export const functionAuthPolicyEnum = z.enum(['admin', 'user', 'none']);

// Base function schema
export const functionSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  code: z.string(),
  status: z.enum(['draft', 'active', 'error']),
  auth: functionAuthPolicyEnum.default('user'),
  createdAt: z.string(),
  updatedAt: z.string(),
  deployedAt: z.string().nullable(),
});

export type FunctionSchema = z.infer<typeof functionSchema>;
