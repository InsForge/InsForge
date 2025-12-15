import { z } from 'zod';
import {
  emailSchema,
  passwordSchema,
  nameSchema,
  userIdSchema,
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
 * PATCH /api/auth/profiles/current - Update current user's profile
 */
export const updateProfileRequestSchema = z.object({
  profile: z.record(z.unknown()),
});

/**
 * POST /api/auth/email/send-verification - Send verification email (code or link based on config)
 */
export const sendVerificationEmailRequestSchema = z.object({
  email: emailSchema,
});

/**
 * POST /api/auth/email/verify - Verify email with OTP
 * Uses verifyEmailMethod from auth config to determine verification type:
 * - 'code': expects email + 6-digit numeric code
 * - 'link': expects 64-char hex token only
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
 * POST /api/auth/email/send-reset-password - Send reset password email (code or link based on config)
 */
export const sendResetPasswordEmailRequestSchema = z.object({
  email: emailSchema,
});

/**
 * POST /api/auth/email/exchange-reset-password-token - Exchange reset password code for reset token
 * Used in two-step password reset flow (code method only): exchange code for token, then reset password with token
 */
export const exchangeResetPasswordTokenRequestSchema = z.object({
  email: emailSchema,
  code: z.string().min(1),
});

/**
 * POST /api/auth/email/reset-password - Reset password with token
 * Token can be:
 * - Magic link token (from send-reset-password endpoint when method is 'link')
 * - Reset token (from exchange-reset-password-token endpoint after code verification)
 * Both use RESET_PASSWORD purpose and are verified the same way
 */
export const resetPasswordRequestSchema = z.object({
  newPassword: passwordSchema,
  otp: z.string().min(1, 'OTP/token is required'),
});

// ============================================================================
// Response schemas
// ============================================================================

/**
 * Response for POST /api/auth/users
 * Includes optional redirectTo URL when user is successfully registered and email verification is not required
 */
export const createUserResponseSchema = z.object({
  user: userSchema.optional(),
  accessToken: z.string().nullable(),
  requireEmailVerification: z.boolean().optional(),
  redirectTo: z.string().url().optional(),
});

/**
 * Response for POST /api/auth/sessions
 * Includes user and access token, plus optional redirectTo URL for frontend navigation
 */
export const createSessionResponseSchema = z.object({
  user: userSchema,
  accessToken: z.string(),
  redirectTo: z.string().url().optional(),
});

/**
 * Response for POST /api/auth/email/verify
 * Includes user and access token, plus optional redirectTo URL for frontend navigation
 */
export const verifyEmailResponseSchema = z.object({
  user: userSchema,
  accessToken: z.string(),
  redirectTo: z.string().url().optional(),
});

/**
 * Response for POST /api/auth/email/exchange-reset-password-token
 * Returns reset token that can be used to reset password
 */
export const exchangeResetPasswordTokenResponseSchema = z.object({
  token: z.string(),
  expiresAt: z.string().datetime(),
});

/**
 * Response for POST /api/auth/email/reset-password
 * Includes success message
 */
export const resetPasswordResponseSchema = z.object({
  message: z.string(),
});

/**
 * Response for POST /api/auth/admin/sessions
 */
export const createAdminSessionResponseSchema = createUserResponseSchema;

/**
 * Response for GET /api/auth/sessions/current
 */
export const getCurrentSessionResponseSchema = z.object({
  user: userSchema,
});

/**
 * Response for GET /api/auth/profiles/:userId - Get user profile
 */
export const getProfileResponseSchema = z.object({
  id: userIdSchema,
  profile: z.record(z.unknown()).nullable(),
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
    signInRedirectTo: true,
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
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;
export type CreateOAuthConfigRequest = z.infer<typeof createOAuthConfigRequestSchema>;
export type UpdateOAuthConfigRequest = z.infer<typeof updateOAuthConfigRequestSchema>;
export type UpdateAuthConfigRequest = z.infer<typeof updateAuthConfigRequestSchema>;
export type SendVerificationEmailRequest = z.infer<typeof sendVerificationEmailRequestSchema>;
export type VerifyEmailRequest = z.infer<typeof verifyEmailRequestSchema>;
export type SendResetPasswordEmailRequest = z.infer<typeof sendResetPasswordEmailRequestSchema>;
export type ExchangeResetPasswordTokenRequest = z.infer<
  typeof exchangeResetPasswordTokenRequestSchema
>;
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;

// Response types for type-safe responses
export type CreateUserResponse = z.infer<typeof createUserResponseSchema>;
export type CreateSessionResponse = z.infer<typeof createSessionResponseSchema>;
export type VerifyEmailResponse = z.infer<typeof verifyEmailResponseSchema>;
export type ExchangeResetPasswordTokenResponse = z.infer<
  typeof exchangeResetPasswordTokenResponseSchema
>;
export type ResetPasswordResponse = z.infer<typeof resetPasswordResponseSchema>;
export type CreateAdminSessionResponse = z.infer<typeof createAdminSessionResponseSchema>;
export type GetCurrentSessionResponse = z.infer<typeof getCurrentSessionResponseSchema>;
export type GetProfileResponse = z.infer<typeof getProfileResponseSchema>;
export type ListUsersResponse = z.infer<typeof listUsersResponseSchema>;
export type DeleteUsersResponse = z.infer<typeof deleteUsersResponseSchema>;
export type GetOauthUrlResponse = z.infer<typeof getOauthUrlResponseSchema>;
export type ListOAuthConfigsResponse = z.infer<typeof listOAuthConfigsResponseSchema>;
export type GetAuthConfigResponse = z.infer<typeof getAuthConfigResponseSchema>;
export type GetPublicAuthConfigResponse = z.infer<typeof getPublicAuthConfigResponseSchema>;

export type AuthErrorResponse = z.infer<typeof authErrorResponseSchema>;
