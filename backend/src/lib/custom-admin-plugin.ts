import { z } from 'zod';
import { APIError } from 'better-call';
import { createAuthEndpoint, createAuthMiddleware } from 'better-auth/api';
import type { BetterAuthPlugin } from 'better-auth/types/plugins';
import { BetterAuthAdminService } from '@/core/auth/better-auth-admin-service.js';

// Middleware to verify project admin role from JWT
const requireProjectAdmin = createAuthMiddleware(async (ctx) => {
  const authService = BetterAuthAdminService.getInstance();

  const authHeader = ctx.request?.headers.get('authorization') || ctx.headers?.get('authorization');

  if (!authHeader) {
    throw new APIError('UNAUTHORIZED', {
      message: 'Missing authorization header',
    });
  }

  const token = authHeader.replace('Bearer ', '');

  // Use BetterAuthAdminService to verify admin token
  const adminInfo = await authService.verifyAdminToken(token);

  return {
    context: {
      adminInfo,
    },
  };
});

export const customAdminPlugin: BetterAuthPlugin = {
  id: 'custom-admin',
  endpoints: {
    // Admin register - creates admin user in DB
    registerAdmin: createAuthEndpoint(
      '/admin/register',
      {
        method: 'POST',
        body: z.object({
          email: z.string().email(),
          password: z.string(),
          name: z.string().optional().default('Administrator'),
        }),
      },
      async (ctx) => {
        const authService = BetterAuthAdminService.getInstance();
        return ctx.json(await authService.registerAdmin(ctx.body));
      }
    ),

    // Admin sign-in
    signInAdmin: createAuthEndpoint(
      '/admin/sign-in',
      {
        method: 'POST',
        body: z.object({
          email: z.string().email(),
          password: z.string(),
        }),
      },
      async (ctx) => {
        const authService = BetterAuthAdminService.getInstance();
        return ctx.json(await authService.signInAdmin(ctx.body));
      }
    ),

    // List users
    listUsers: createAuthEndpoint(
      '/admin/users',
      {
        method: 'GET',
        query: z.object({
          limit: z.coerce.number().optional().default(10),
          offset: z.coerce.number().optional().default(0),
        }),
        use: [requireProjectAdmin],
      },
      async (ctx) => {
        const authService = BetterAuthAdminService.getInstance();
        const { limit, offset } = ctx.query;
        return ctx.json(await authService.listUsers(limit, offset));
      }
    ),
  },
};
