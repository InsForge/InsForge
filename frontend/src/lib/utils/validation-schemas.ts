import { z } from 'zod';

// Common field schemas
export const emailSchema = z.string().min(1, 'Email is required').email('Invalid email address');

export const passwordSchema = z.string().min(6, 'Password must be at least 6 characters');

export const requiredStringSchema = z.string().min(1, 'This field is required');

export const optionalStringSchema = z.string().optional().nullable();

export const numberSchema = z.number().or(z.string().regex(/^\d+$/).transform(Number));

export const booleanSchema = z.boolean().or(z.string().transform((val) => val === 'true'));

export const dateSchema = z
  .string()
  .or(z.date())
  .transform((val) => new Date(val));

// Common form schemas
export const loginFormSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export const userFormSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: requiredStringSchema,
  role: z.enum(['admin', 'user']).default('user'),
});

// Type exports
export type LoginFormData = z.infer<typeof loginFormSchema>;
export type UserFormData = z.infer<typeof userFormSchema>;
