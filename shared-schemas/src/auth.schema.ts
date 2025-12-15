import { z } from 'zod';

/**
 * Core auth entity schemas (PostgreSQL structure)
 * These define the fundamental auth data models
 */

// ============================================================================
// Base field schemas
// ============================================================================

export const userIdSchema = z.string().uuid('Invalid user ID format');

export const emailSchema = z.string().email('Invalid email format').toLowerCase().trim();

export const passwordSchema = z.string();

export const nameSchema = z
  .string()
  .min(1, 'Name is required')
  .max(100, 'Name must be less than 100 characters')
  .trim();

export const roleSchema = z.enum(['anon', 'authenticated', 'project_admin']);

export const verificationMethodSchema = z.enum(['code', 'link']);

/**
 * User profile schema with default fields and passthrough for custom fields
 * Note: Using snake_case for fields as they are stored directly in PostgreSQL JSONB
 */
export const profileSchema = z
  .object({
    name: z.string().optional(),
    // eslint-disable-next-line @typescript-eslint/naming-convention
    avatar_url: z.string().url().optional(),
  })
  .passthrough();

// ============================================================================
// Core entity schemas
// ============================================================================

/**
 * User entity schema - represents the auth.users table in PostgreSQL
 */
export const userSchema = z.object({
  id: userIdSchema,
  email: emailSchema,
  emailVerified: z.boolean(),
  providers: z.array(z.string()).optional(),
  createdAt: z.string(), // PostgreSQL timestamp
  updatedAt: z.string(), // PostgreSQL timestamp
  profile: profileSchema.nullable(), // User profile data (name, avatar_url, bio, etc.)
  metadata: z.record(z.unknown()).nullable(), // System metadata (device ID, login IP, etc.)
});

/**
 * OAuth state for redirect handling
 */

export const oAuthProvidersSchema = z.enum([
  'google',
  'github',
  'discord',
  'linkedin',
  'facebook',
  'instagram',
  'tiktok',
  'apple',
  'x',
  'spotify',
  'microsoft',
]);

export const oAuthStateSchema = z.object({
  provider: oAuthProvidersSchema,
  redirectUri: z.string().url().optional(),
});

// OAuth provider configuration schema
export const oAuthConfigSchema = z.object({
  id: z.string().uuid(),
  provider: oAuthProvidersSchema,
  clientId: z.string().optional(),
  scopes: z.array(z.string()).optional(),
  redirectUri: z.string().optional(),
  useSharedKey: z.boolean(),
  createdAt: z.string(), // PostgreSQL timestamp
  updatedAt: z.string(), // PostgreSQL timestamp
});

// Email authentication configuration schema
export const authConfigSchema = z.object({
  id: z.string().uuid(),
  requireEmailVerification: z.boolean(),
  passwordMinLength: z.number().min(4).max(128),
  requireNumber: z.boolean(),
  requireLowercase: z.boolean(),
  requireUppercase: z.boolean(),
  requireSpecialChar: z.boolean(),
  verifyEmailMethod: verificationMethodSchema,
  resetPasswordMethod: verificationMethodSchema,
  signInRedirectTo: z
    .union([z.string().url(), z.literal(''), z.null()])
    .optional()
    .transform((val) => (val === '' ? null : val)),
  createdAt: z.string(), // PostgreSQL timestamp
  updatedAt: z.string(), // PostgreSQL timestamp
});

/**
 * JWT token payload schema
 */
export const tokenPayloadSchema = z.object({
  sub: userIdSchema, // Subject (user ID)
  email: emailSchema,
  role: roleSchema,
  iat: z.number().optional(), // Issued at
  exp: z.number().optional(), // Expiration
});

// ============================================================================
// Type exports
// ============================================================================

export type UserIdSchema = z.infer<typeof userIdSchema>;
export type EmailSchema = z.infer<typeof emailSchema>;
export type PasswordSchema = z.infer<typeof passwordSchema>;
export type RoleSchema = z.infer<typeof roleSchema>;
export type VerificationMethodSchema = z.infer<typeof verificationMethodSchema>;
export type ProfileSchema = z.infer<typeof profileSchema>;
export type UserSchema = z.infer<typeof userSchema>;
export type TokenPayloadSchema = z.infer<typeof tokenPayloadSchema>;
export type OAuthConfigSchema = z.infer<typeof oAuthConfigSchema>;
export type OAuthProvidersSchema = z.infer<typeof oAuthProvidersSchema>;
export type AuthConfigSchema = z.infer<typeof authConfigSchema>;
