import { z } from 'zod';
import { AppError } from '@/utils/errors.js';
import { ERROR_CODES } from '@insforge/shared-schemas';
import type { AuthRequest, UserContext } from '@/api/middlewares/auth.js';

// Shared by the kv and vectors stores. API keys and the admin dashboard
// (project_admin JWT) manage the project-global store with full access via the
// superuser pool (RLS bypassed); genuine end users operate as their own
// authenticated/anon identity through RLS.
export type StoreActor = { mode: 'admin' } | { mode: 'user'; ctx: UserContext };

export function resolveStoreActor(req: AuthRequest): StoreActor {
  if (req.hasApiKey || req.user?.role === 'project_admin') {
    return { mode: 'admin' };
  }
  if (!req.user) {
    throw new AppError('Authentication required', 401, ERROR_CODES.AUTH_UNAUTHORIZED);
  }
  return { mode: 'user', ctx: req.user };
}

export function parseBody<S extends z.ZodTypeAny>(schema: S, body: unknown): z.infer<S> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new AppError(
      `Validation error: ${parsed.error.errors.map((e) => e.message).join(', ')}`,
      400,
      ERROR_CODES.INVALID_INPUT
    );
  }
  return parsed.data;
}

// Validate a single path param against a shared schema so the HTTP surface
// matches the exported contract instead of trusting raw req.params.
export function parseParam(schema: z.ZodType<string>, value: string, label: string): string {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new AppError(
      `Invalid ${label}: ${parsed.error.errors.map((e) => e.message).join(', ')}`,
      400,
      ERROR_CODES.INVALID_INPUT
    );
  }
  return parsed.data;
}
