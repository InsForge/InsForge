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

export const roleSchema = z.enum(['authenticated', 'project_admin']);

// ============================================================================
// Core entity schemas
// ============================================================================

/**
 * User entity schema - represents the _user table in PostgreSQL
 */
export const userSchema = z.object({
  id: userIdSchema,
  email: emailSchema,
  name: nameSchema,
  emailVerified: z.boolean(),
  identities: z
    .array(
      z.object({
        provider: z.string(),
      })
    )
    .optional(),
  providerType: z.string().optional(),
  createdAt: z.string(), // PostgreSQL timestamp
  updatedAt: z.string(), // PostgreSQL timestamp
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
export const emailAuthConfigSchema = z.object({
  id: z.string().uuid(),
  requireEmailVerification: z.boolean(),
  passwordMinLength: z.number().min(4).max(128),
  requireNumber: z.boolean(),
  requireLowercase: z.boolean(),
  requireUppercase: z.boolean(),
  requireSpecialChar: z.boolean(),
  verifyEmailRedirectTo: z
    .union([z.string().url(), z.literal(''), z.null()])
    .optional()
    .transform((val) => (val === '' ? null : val)),
  resetPasswordRedirectTo: z
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

/**
 * User profile schema - represents the users table in PostgreSQL
 * This table stores additional user profile information (nickname, avatar, bio, etc.)
 */
export const profileSchema = z.object({
  id: userIdSchema, // References _accounts(id)
  nickname: z.string().nullable().optional(),
  avatar_url: z.string().nullable().optional(),
  bio: z.string().nullable().optional(),
  birthday: z.string().nullable().optional(), // PostgreSQL DATE as ISO string (YYYY-MM-DD)
  created_at: z.string(), // PostgreSQL TIMESTAMPTZ
  updated_at: z.string(), // PostgreSQL TIMESTAMPTZ
});

/**
 * User profile update schema - for updating profile fields
 */
export const updateProfileSchema = profileSchema
  .omit({
    id: true,
    created_at: true,
    updated_at: true,
  })
  .partial();

// ============================================================================
// Type exports
// ============================================================================

export type UserIdSchema = z.infer<typeof userIdSchema>;
export type EmailSchema = z.infer<typeof emailSchema>;
export type PasswordSchema = z.infer<typeof passwordSchema>;
export type RoleSchema = z.infer<typeof roleSchema>;
export type UserSchema = z.infer<typeof userSchema>;
export type TokenPayloadSchema = z.infer<typeof tokenPayloadSchema>;
export type OAuthConfigSchema = z.infer<typeof oAuthConfigSchema>;
export type OAuthProvidersSchema = z.infer<typeof oAuthProvidersSchema>;
export type EmailAuthConfigSchema = z.infer<typeof emailAuthConfigSchema>;
export type ProfileSchema = z.infer<typeof profileSchema>;
export type UpdateProfileSchema = z.infer<typeof updateProfileSchema>;
