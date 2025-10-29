import { z } from 'zod';
import {
  emailSchema,
  passwordSchema,
  nameSchema,
  userIdSchema,
  roleSchema,
  userSchema,
  oAuthConfigSchema,
} from './auth.schema';

// ============================================================================
// Common schemas
// ============================================================================

/**
 * Pagination parameters shared across list endpoints
 */
export const paginationSchema = z.object({
  limit: z.string().optional(),
  offset: z.string().optional(),
});

/**
 * POST /api/auth/users - Create user
 */
export const createUserRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: nameSchema.optional(),
});

/**
 * POST /api/auth/sessions - Create session
 */
export const createSessionRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

/**
 * POST /api/auth/admin/sessions - Create admin session
 */
export const createAdminSessionRequestSchema = createSessionRequestSchema;

export const exchangeAdminSessionRequestSchema = z.object({
  code: z.string(),
});

/**
 * GET /api/auth/users - List users (query parameters)
 */
export const listUsersRequestSchema = paginationSchema
  .extend({
    search: z.string().optional(),
  })
  .optional();

/**
 * DELETE /api/auth/users - Delete users (batch)
 */
export const deleteUsersRequestSchema = z.object({
  userIds: z.array(userIdSchema).min(1, 'At least one user ID is required'),
});

// ============================================================================
// Response schemas
// ============================================================================

/**
 * Response for POST /api/auth/users
 */
export const createUserResponseSchema = z.object({
  user: userSchema,
  accessToken: z.string(),
});

/**
 * Response for POST /api/auth/sessions
 */
export const createSessionResponseSchema = createUserResponseSchema;

/**
 * Response for POST /api/auth/admin/sessions
 */
export const createAdminSessionResponseSchema = createUserResponseSchema;

/**
 * Response for GET /api/auth/sessions/current
 */
export const getCurrentSessionResponseSchema = z.object({
  user: z.object({
    id: userIdSchema,
    email: emailSchema,
    role: roleSchema,
  }),
});

/**
 * Response for GET /api/auth/users
 */
export const listUsersResponseSchema = z.object({
  data: z.array(userSchema),
  pagination: z.object({
    offset: z.number(),
    limit: z.number(),
    total: z.number(),
  }),
});

/**
 * Response for DELETE /api/auth/users
 */
export const deleteUsersResponseSchema = z.object({
  message: z.string(),
  deletedCount: z.number().int().nonnegative(),
});

/**
 * Response for GET /api/auth/v1/google-auth and GET /api/auth/v1/github-auth
 */
export const getOauthUrlResponseSchema = z.object({
  authUrl: z.string().url(),
});

// ============================================================================
// OAuth Configuration Management schemas
// ============================================================================

/**
 * POST /api/auth/oauth/configs - Create OAuth configuration
 */
export const createOAuthConfigRequestSchema = oAuthConfigSchema
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    clientSecret: z.string().optional(),
  });

/**
 * PUT /api/auth/oauth/configs/:provider - Update OAuth configuration
 */
export const updateOAuthConfigRequestSchema = oAuthConfigSchema
  .omit({
    id: true,
    provider: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    clientSecret: z.string().optional(),
  })
  .partial();

/**
 * Response for GET /api/auth/oauth/configs
 */
export const listOAuthConfigsResponseSchema = z.object({
  data: z.array(oAuthConfigSchema),
  count: z.number(),
});

// ============================================================================
// Error response schema
// ============================================================================

/**
 * Standard error response format for auth endpoints
 */
export const authErrorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
  statusCode: z.number().int(),
  nextActions: z.string().optional(),
});

// ============================================================================
// Type exports
// ============================================================================

// Request types for type-safe request handling
export type CreateUserRequest = z.infer<typeof createUserRequestSchema>;
export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>;
export type CreateAdminSessionRequest = z.infer<typeof createAdminSessionRequestSchema>;
export type ListUsersRequest = z.infer<typeof listUsersRequestSchema>;
export type DeleteUsersRequest = z.infer<typeof deleteUsersRequestSchema>;
export type CreateOAuthConfigRequest = z.infer<typeof createOAuthConfigRequestSchema>;
export type UpdateOAuthConfigRequest = z.infer<typeof updateOAuthConfigRequestSchema>;

// Response types for type-safe responses
export type CreateUserResponse = z.infer<typeof createUserResponseSchema>;
export type CreateSessionResponse = z.infer<typeof createSessionResponseSchema>;
export type CreateAdminSessionResponse = z.infer<typeof createAdminSessionResponseSchema>;
export type GetCurrentSessionResponse = z.infer<typeof getCurrentSessionResponseSchema>;
export type ListUsersResponse = z.infer<typeof listUsersResponseSchema>;
export type DeleteUsersResponse = z.infer<typeof deleteUsersResponseSchema>;
export type GetOauthUrlResponse = z.infer<typeof getOauthUrlResponseSchema>;
export type ListOAuthConfigsResponse = z.infer<typeof listOAuthConfigsResponseSchema>;

export type AuthErrorResponse = z.infer<typeof authErrorResponseSchema>;
