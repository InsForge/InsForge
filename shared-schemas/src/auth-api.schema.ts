import { z } from 'zod';
import {
  emailSchema,
  passwordSchema,
  nameSchema,
  userIdSchema,
  roleSchema,
  userSchema,
  oAuthConfigSchema,
  oAuthProvidersSchema,
  authConfigSchema,
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

/**
 * POST /api/auth/resend-verification-email - Resend verification email
 */
export const sendVerificationEmailRequestSchema = z.object({
  email: emailSchema,
});

/**
 * POST /api/auth/verify-email - Verify email with OTP
 * - With email: numeric OTP verification (email + otp required, otp is 6-digit code)
 * - Without email: link OTP verification (otp required, otp is 64-char hex token)
 */
export const verifyEmailRequestSchema = z
  .object({
    email: emailSchema.optional(),
    otp: z.string().min(1),
  })
  .refine((data) => data.email || data.otp, {
    message: 'Either email or otp must be provided',
  });

/**
 * POST /api/auth/send-reset-password-email - Send reset password email
 */
export const sendResetPasswordEmailRequestSchema = z.object({
  email: emailSchema,
});

/**
 * POST /api/auth/verify-reset-password-code - Verify reset password code and get reset token
 * Used in two-step password reset flow: verify code first, then reset password with token
 */
export const verifyResetPasswordCodeRequestSchema = z.object({
  email: emailSchema,
  code: z.string().min(1),
});

/**
 * POST /api/auth/reset-password - Reset password with token
 * Token can be:
 * - Magic link token (from send-reset-password-link endpoint)
 * - Reset token (from verify-reset-password-code endpoint after code verification)
 * Both use RESET_PASSWORD purpose and are verified the same way
 * resetToken is an alias for otp (for backward compatibility)
 */
export const resetPasswordRequestSchema = z
  .object({
    newPassword: passwordSchema,
    otp: z.string().min(1).optional(),
  })
  .refine((data) => data.otp, {
    message: 'otp must be provided',
  });

// ============================================================================
// Response schemas
// ============================================================================

/**
 * Response for POST /api/auth/users
 */
export const createUserResponseSchema = z.object({
  user: userSchema.optional(),
  accessToken: z.string().nullable(),
  requiresEmailVerification: z.boolean().optional(),
});

/**
 * Response for POST /api/auth/sessions
 */
export const createSessionResponseSchema = z.object({
  user: userSchema,
  accessToken: z.string(),
});

/**
 * Response for POST /api/auth/verify-email
 * Includes user and access token, plus optional redirectTo URL for frontend navigation
 */
export const verifyEmailResponseSchema = z.object({
  user: userSchema,
  accessToken: z.string(),
  redirectTo: z.string().url().optional(),
});

/**
 * Response for POST /api/auth/verify-reset-password-code
 * Returns reset token that can be used to reset password
 */
export const verifyResetPasswordCodeResponseSchema = z.object({
  resetToken: z.string(),
  expiresAt: z.string().datetime(),
});

/**
 * Response for POST /api/auth/reset-password
 * Includes success message and optional redirectTo URL for frontend navigation
 */
export const resetPasswordResponseSchema = z.object({
  message: z.string(),
  redirectTo: z.string().url().optional(),
});

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
// Authentication Configuration schemas
// ============================================================================

/**
 * PUT /api/auth/config - Update authentication configuration
 */
export const updateAuthConfigRequestSchema = authConfigSchema
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .partial();

/**
 * Response for GET /api/auth/config
 */
export const getAuthConfigResponseSchema = authConfigSchema;

/**
 * Response for GET /api/auth/public-config - Unified public auth configuration endpoint
 * Combines OAuth providers and email auth configuration
 */
export const getPublicAuthConfigResponseSchema = z.object({
  oAuthProviders: z.array(oAuthProvidersSchema),
  ...authConfigSchema.omit({
    id: true,
    updatedAt: true,
    createdAt: true,
  }).shape,
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
export type UpdateAuthConfigRequest = z.infer<typeof updateAuthConfigRequestSchema>;
export type SendVerificationEmailRequest = z.infer<typeof sendVerificationEmailRequestSchema>;
export type VerifyEmailRequest = z.infer<typeof verifyEmailRequestSchema>;
export type SendResetPasswordEmailRequest = z.infer<typeof sendResetPasswordEmailRequestSchema>;
export type VerifyResetPasswordCodeRequest = z.infer<typeof verifyResetPasswordCodeRequestSchema>;
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;

// Response types for type-safe responses
export type CreateUserResponse = z.infer<typeof createUserResponseSchema>;
export type CreateSessionResponse = z.infer<typeof createSessionResponseSchema>;
export type VerifyEmailResponse = z.infer<typeof verifyEmailResponseSchema>;
export type VerifyResetPasswordCodeResponse = z.infer<typeof verifyResetPasswordCodeResponseSchema>;
export type ResetPasswordResponse = z.infer<typeof resetPasswordResponseSchema>;
export type CreateAdminSessionResponse = z.infer<typeof createAdminSessionResponseSchema>;
export type GetCurrentSessionResponse = z.infer<typeof getCurrentSessionResponseSchema>;
export type ListUsersResponse = z.infer<typeof listUsersResponseSchema>;
export type DeleteUsersResponse = z.infer<typeof deleteUsersResponseSchema>;
export type GetOauthUrlResponse = z.infer<typeof getOauthUrlResponseSchema>;
export type ListOAuthConfigsResponse = z.infer<typeof listOAuthConfigsResponseSchema>;
export type GetAuthConfigResponse = z.infer<typeof getAuthConfigResponseSchema>;
export type GetPublicAuthConfigResponse = z.infer<typeof getPublicAuthConfigResponseSchema>;

export type AuthErrorResponse = z.infer<typeof authErrorResponseSchema>;
