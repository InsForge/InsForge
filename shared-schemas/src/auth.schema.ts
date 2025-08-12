import { z } from 'zod';

/**
 * Core auth entity schemas (PostgreSQL structure)
 * These define the fundamental auth data models
 */

// ============================================================================
// Base field schemas
// ============================================================================

export const userIdSchema = z.string().uuid('Invalid user ID format');

export const emailSchema = z
  .string({ required_error: 'Email is required' })
  .email('Invalid email format')
  .toLowerCase()
  .trim();

export const passwordSchema = z
  .string({ required_error: 'Password is required' })
  .min(6, 'Password must be at least 6 characters')
  .max(32, 'Password must be less than 32 characters');

export const nameSchema = z
  .string()
  .min(1, 'Name is required')
  .max(100, 'Name must be less than 100 characters')
  .trim();

export const roleSchema = z.enum(['authenticated', 'project_admin']);

export const oauthProviderSchema = z.enum(['google', 'github']);

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
  createdAt: z.string(), // PostgreSQL timestamp
  updatedAt: z.string(), // PostgreSQL timestamp
});

/**
 * OAuth state for redirect handling
 */
export const oauthStateSchema = z.object({
  provider: oauthProviderSchema,
  redirectUrl: z.string().url().optional(),
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
export type UserSchema = z.infer<typeof userSchema>;
export type TokenPayloadSchema = z.infer<typeof tokenPayloadSchema>;  
