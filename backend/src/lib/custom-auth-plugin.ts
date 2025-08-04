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

export const customAuthPlugin: BetterAuthPlugin = {
  id: 'custom-auth',
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

    // Get single user by ID
    getUser: createAuthEndpoint(
      '/admin/users/:id',
      {
        method: 'GET',
        use: [requireProjectAdmin],
      },
      async (ctx) => {
        const authService = BetterAuthAdminService.getInstance();
        const userId = ctx.params?.id as string;
        return ctx.json(await authService.getUser(userId));
      }
    ),

    // Universal /me endpoint that works for both session tokens and JWT tokens
    me: createAuthEndpoint(
      '/me',
      {
        method: 'GET',
      },
      async (ctx) => {
        const authHeader =
          ctx.request?.headers.get('authorization') || ctx.headers?.get('authorization');

        if (!authHeader) {
          throw new APIError('UNAUTHORIZED', {
            message: 'Missing authorization header',
          });
        }

        const token = authHeader.replace('Bearer ', '');

        // First, try as admin JWT token
        try {
          const authService = BetterAuthAdminService.getInstance();
          const decoded = await authService.verifyToken(token);

          // It's a valid JWT token (admin)
          if (!decoded.sub || !decoded.email) {
            throw new APIError('UNAUTHORIZED', {
              message: 'Invalid token payload',
            });
          }

          return ctx.json({
            user: {
              id: decoded.sub,
              email: decoded.email,
              type: decoded.type,
              role: decoded.role,
            },
          });
        } catch {
          // Not a JWT, might be a session token
        }

        // Try as Better Auth session token
        try {
          // Use Better Auth's adapter to query the session directly
          const db = ctx.context.adapter;

          // Define minimal types for what we need, these will be moved to shared tyles or better auth tyupes in the future
          interface SessionRecord {
            id: string;
            userId: string;
            token: string;
          }

          interface UserRecord {
            id: string;
            email: string;
          }

          const session = (await db.findOne({
            model: 'session',
            where: [{ field: 'token', value: token }],
          })) as SessionRecord | null;

          if (session && session.userId) {
            const user = (await db.findOne({
              model: 'user',
              where: [{ field: 'id', value: session.userId }],
            })) as UserRecord | null;

            if (user && user.email) {
              return ctx.json({
                user: {
                  id: user.id,
                  email: user.email,
                  type: 'user' as const,
                  role: 'authenticated' as const,
                },
              });
            }
          }
        } catch {
          // Failed to get session
        }

        throw new APIError('UNAUTHORIZED', {
          message: 'Invalid token',
        });
      }
    ),

    // Bulk delete users
    bulkDeleteUsers: createAuthEndpoint(
      '/admin/users/bulk-delete',
      {
        method: 'DELETE',
        body: z.object({
          userIds: z.array(z.string()),
        }),
        use: [requireProjectAdmin],
      },
      async (ctx) => {
        const authService = BetterAuthAdminService.getInstance();
        return ctx.json(await authService.bulkDeleteUsers(ctx.body.userIds));
      }
    ),
  },
};
