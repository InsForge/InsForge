import { z } from 'zod';
import {
  emailSchema,
  passwordSchema,
  nameSchema,
  userIdSchema,
  userSchema,
  profileSchema,
  oAuthConfigSchema,
  oAuthProvidersSchema,
  authConfigSchema,
  customOAuthConfigSchema,
  customOAuthKeySchema,
  resendConfigSchema,
  smtpConfigSchema,
  emailTemplateSchema,
} from './auth.schema.js';

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
 * redirectTo is used only for link-based email verification and must be allowlisted.
 */
export const createUserRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: nameSchema.optional(),
  redirectTo: z.string().url().optional(),
  autoConfirm: z.boolean().optional(),
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

/**
 * POST /api/auth/refresh - Refresh session
 * Non-web clients send refreshToken in the request body
 */
export const refreshSessionRequestSchema = z.object({
  refreshToken: z.string().min(1, 'refreshToken is required'),
});

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
 * redirectTo is used only for link-based email verification and must be allowlisted.
 */
export const sendVerificationEmailRequestSchema = z.object({
  email: emailSchema,
  redirectTo: z.string().url().optional(),
});

/**
 * POST /api/auth/email/verify - Verify email with a 6-digit code
 * Link verification uses GET /api/auth/email/verify-link instead.
 * The link flow redirects with insforge_status / insforge_type query params and does not create a frontend session.
 */
export const verifyEmailRequestSchema = z.object({
  email: emailSchema,
  otp: z.string().regex(/^\d{6}$/, 'OTP code must be a 6-digit numeric code'),
});

/**
 * POST /api/auth/email/send-reset-password - Send reset password email (code or link based on config)
 * redirectTo is used only for link-based password reset and must be allowlisted.
 */
export const sendResetPasswordEmailRequestSchema = z.object({
  email: emailSchema,
  redirectTo: z.string().url().optional(),
});

/**
 * POST /api/auth/email/exchange-reset-password-token - Exchange reset password code for reset token
 * Used in two-step password reset flow (code method only): exchange code for token, then reset password with token
 */
export const exchangeResetPasswordTokenRequestSchema = z.object({
  email: emailSchema,
  code: z.string().regex(/^\d{6}$/, 'Reset password code must be a 6-digit numeric code'),
});

/**
 * POST /api/auth/email/reset-password - Reset password with token
 * Token can be:
 * - Magic link token (from send-reset-password endpoint when method is 'link')
 * - Reset token (from exchange-reset-password-token endpoint after code verification)
 * Both use RESET_PASSWORD purpose and are verified the same way
 * The link flow redirects with token / insforge_status / insforge_type query params.
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
 * For mobile/desktop clients: refreshToken is returned in body instead of cookie
 */
export const createUserResponseSchema = z.object({
  user: userSchema.optional(),
  accessToken: z.string().nullable(),
  requireEmailVerification: z.boolean().optional(),
  csrfToken: z.string().nullable().optional(),
  refreshToken: z.string().optional(), // For mobile/desktop clients (no cookies)
});

/**
 * Response for POST /api/auth/sessions
 * For mobile/desktop clients: refreshToken is returned in body instead of cookie
 */
export const createSessionResponseSchema = z.object({
  user: userSchema,
  accessToken: z.string(),
  csrfToken: z.string().nullable().optional(),
  refreshToken: z.string().optional(), // For mobile/desktop clients (no cookies)
});

/**
 * Response for POST /api/auth/email/verify
 * For mobile/desktop clients: refreshToken is returned in body instead of cookie
 */
export const verifyEmailResponseSchema = z.object({
  user: userSchema,
  accessToken: z.string(),
  csrfToken: z.string().nullable().optional(),
  refreshToken: z.string().optional(), // For mobile/desktop clients (no cookies)
});

/**
 * Response for POST /api/auth/refresh
 * Returns new access token after token refresh
 * For web clients: csrfToken is returned (refresh token is in cookie)
 * For mobile/desktop clients: refreshToken is returned in body
 */
export const refreshSessionResponseSchema = z.object({
  accessToken: z.string(),
  user: userSchema,
  csrfToken: z.string().optional(), // For web clients (cookie-based)
  refreshToken: z.string().optional(), // For mobile/desktop clients (no cookies)
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
export const createAdminSessionResponseSchema = createSessionResponseSchema;

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
  profile: profileSchema.nullable(),
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
 * PKCE character validation regex (RFC 7636 unreserved characters)
 * Allows: A-Z, a-z, 0-9, -, ., _, ~ (no padding)
 */
const pkceRegex = /^[A-Za-z0-9._~-]+$/;

/**
 * GET /api/auth/oauth/:provider - Initialize OAuth flow
 * Query params for PKCE flow as per RFC 7636
 * Note: code_challenge uses snake_case as per OAuth 2.0 PKCE specification
 */
export const oAuthInitRequestSchema = z.object({
  // eslint-disable-next-line @typescript-eslint/naming-convention
  redirect_uri: z.string().url().optional(),
  // eslint-disable-next-line @typescript-eslint/naming-convention
  code_challenge: z
    .string()
    .min(43, 'Code challenge must be at least 43 characters')
    .max(128, 'Code challenge must be at most 128 characters')
    .regex(pkceRegex, 'Code challenge must be base64url encoded'),
});

/**
 * POST /api/auth/oauth/exchange - Exchange OAuth code for tokens
 * Note: code_verifier uses snake_case as per OAuth 2.0 PKCE specification (RFC 7636)
 */
export const oAuthCodeExchangeRequestSchema = z.object({
  code: z.string().min(1, 'Exchange code is required'),
  // eslint-disable-next-line @typescript-eslint/naming-convention
  code_verifier: z
    .string()
    .min(43, 'Code verifier must be at least 43 characters')
    .max(128, 'Code verifier must be at most 128 characters')
    .regex(pkceRegex, 'Code verifier must be base64url encoded'),
});

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
  customOAuthProviders: z.array(customOAuthKeySchema),
  ...authConfigSchema.omit({
    id: true,
    updatedAt: true,
    createdAt: true,
    allowedRedirectUrls: true,
  }).shape,
});

// ============================================================================
// Resend Configuration schemas
// ============================================================================

/**
 * PUT /api/auth/resend-config - Upsert Resend configuration
 * Sender fields are only required when enabling Resend.
 */
export const upsertResendConfigRequestSchema = z.discriminatedUnion('enabled', [
  z.object({
    enabled: z.literal(false),
    apiKey: z.string().optional(),
    senderEmail: z.string().optional().default(''),
    senderName: z.string().optional().default(''),
  }),
  z.object({
    enabled: z.literal(true),
    apiKey: z.string().min(1, 'Resend API key is required').optional(),
    senderEmail: z.string().email('Invalid sender email'),
    senderName: z.string().min(1, 'Sender name is required'),
  }),
]);

/**
 * Response for GET /api/auth/resend-config
 */
export const getResendConfigResponseSchema = resendConfigSchema;

// ============================================================================
// SMTP Configuration schemas
// ============================================================================

/**
 * PUT /api/auth/smtp-config - Upsert SMTP configuration
 */
export const upsertSmtpConfigRequestSchema = z.object({
  enabled: z.boolean(),
  host: z.string().min(1, 'SMTP host is required'),
  port: z.union([z.literal(25), z.literal(465), z.literal(587), z.literal(2525)], {
    errorMap: () => ({ message: 'Port must be one of: 25, 465, 587, 2525' }),
  }),
  username: z.string().min(1, 'SMTP username is required'),
  password: z.string().min(1, 'SMTP password is required').optional(),
  senderEmail: z.string().email('Invalid sender email'),
  senderName: z.string().min(1, 'Sender name is required'),
  minIntervalSeconds: z.number().int().min(0).default(60),
});

/**
 * Response for GET /api/auth/smtp-config
 */
export const getSmtpConfigResponseSchema = smtpConfigSchema;

// ============================================================================
// Email Template schemas
// ============================================================================

/**
 * PUT /api/auth/email-templates/:type - Update email template
 */
export const updateEmailTemplateRequestSchema = z.object({
  subject: z.string().min(1, 'Subject is required'),
  bodyHtml: z.string().min(1, 'Template body is required'),
});

/**
 * Response for GET /api/auth/email-templates
 */
export const listEmailTemplatesResponseSchema = z.object({
  data: z.array(emailTemplateSchema),
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
export type RefreshSessionRequest = z.infer<typeof refreshSessionRequestSchema>;
export type ListUsersRequest = z.infer<typeof listUsersRequestSchema>;
export type DeleteUsersRequest = z.infer<typeof deleteUsersRequestSchema>;
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;
export type CreateOAuthConfigRequest = z.infer<typeof createOAuthConfigRequestSchema>;
export type UpdateOAuthConfigRequest = z.infer<typeof updateOAuthConfigRequestSchema>;
export type OAuthInitRequest = z.infer<typeof oAuthInitRequestSchema>;
export type OAuthCodeExchangeRequest = z.infer<typeof oAuthCodeExchangeRequestSchema>;
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
export type RefreshSessionResponse = z.infer<typeof refreshSessionResponseSchema>;
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

// ============================================================================
// Custom OAuth Configuration Management schemas
// ============================================================================

export const createCustomOAuthConfigRequestSchema = customOAuthConfigSchema
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    clientSecret: z.string().min(1, 'Client secret is required'),
  });

export const updateCustomOAuthConfigRequestSchema = customOAuthConfigSchema
  .omit({ id: true, key: true, createdAt: true, updatedAt: true })
  .extend({
    clientSecret: z.string().min(1).optional(),
  })
  .partial();

export const listCustomOAuthConfigsResponseSchema = z.object({
  data: z.array(customOAuthConfigSchema),
  count: z.number(),
});

export type CreateCustomOAuthConfigRequest = z.infer<typeof createCustomOAuthConfigRequestSchema>;
export type UpdateCustomOAuthConfigRequest = z.infer<typeof updateCustomOAuthConfigRequestSchema>;
export type ListCustomOAuthConfigsResponse = z.infer<typeof listCustomOAuthConfigsResponseSchema>;
export type UpsertResendConfigRequest = z.infer<typeof upsertResendConfigRequestSchema>;
export type GetResendConfigResponse = z.infer<typeof getResendConfigResponseSchema>;
export type UpsertSmtpConfigRequest = z.infer<typeof upsertSmtpConfigRequestSchema>;
export type GetSmtpConfigResponse = z.infer<typeof getSmtpConfigResponseSchema>;
export type UpdateEmailTemplateRequest = z.infer<typeof updateEmailTemplateRequestSchema>;
export type ListEmailTemplatesResponse = z.infer<typeof listEmailTemplatesResponseSchema>;
