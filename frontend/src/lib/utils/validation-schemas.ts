import { z } from 'zod';

export const uuidSchema = z
  .string()
  .uuid({ message: 'Please enter a valid UUID' })
  .or(z.literal('').transform(() => null))
  .or(z.null());

export const integerSchema = z
  .union([
    z
      .string()
      .regex(/^-?\d+$/, { message: 'Please enter a valid integer' })
      .transform((val) => {
        const num = parseInt(val, 10);
        if (num < -2147483648 || num > 2147483647) {
          throw new Error(
            'Integer value out of range. Please enter a value between -2,147,483,648 and 2,147,483,647'
          );
        }
        return num;
      }),
    z.number().int().min(-2147483648).max(2147483647),
    z.literal('').transform(() => null),
    z.null(),
  ])
  .catch(() => {
    throw new Error('Please enter a valid integer');
  });

export const floatSchema = z
  .union([
    z
      .string()
      .regex(/^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/, {
        message: 'Please enter a valid number',
      })
      .transform((val) => {
        const num = parseFloat(val);
        if (!isFinite(num)) {
          throw new Error('Number value out of range');
        }
        if (Math.abs(num) > 1.7976931348623157e308) {
          throw new Error('Number value exceeds double precision range');
        }
        return num;
      }),
    z.number().finite(),
    z.literal('').transform(() => null),
    z.null(),
  ])
  .catch(() => {
    throw new Error('Please enter a valid number');
  });

export const booleanSchema = z
  .union([
    z.boolean(),
    z.string().transform((val) => {
      const lower = val.toLowerCase();
      if (lower === 'true') {
        return true;
      }
      if (lower === 'false') {
        return false;
      }
      if (lower === 'null' || lower === '') {
        return null;
      }
      throw new Error('Please enter a valid boolean value: true, false, or leave empty');
    }),
    z.literal('').transform(() => null),
    z.null(),
  ])
  .catch(() => {
    throw new Error('Please enter a valid boolean value');
  });

export const dateSchema = z
  .union([z.string().date(), z.literal('').transform(() => null), z.null()])
  .catch(() => {
    throw new Error('Please enter a valid date');
  });

export const dateTimeSchema = z
  .union([
    // ISO 8601 datetime with timezone (Z or ±HH:MM)
    z.string().datetime({ offset: true }),
    z.literal('').transform(() => null),
    z.null(),
  ])
  .catch(() => {
    throw new Error('Please enter a valid datetime');
  });

export const jsonSchema = z
  .union([
    z.string().transform((val) => {
      if (val === '' || val === 'null') {
        return null;
      }
      try {
        return JSON.parse(val);
      } catch {
        throw new Error('Please enter valid JSON');
      }
    }),
    z.object({}).passthrough(),
    z.array(z.unknown()),
    z.null(),
  ])
  .catch(() => {
    throw new Error('Please enter valid JSON');
  });

export const stringSchema = z.union([z.string(), z.null()]);

// Auth validation schemas
export const emailSchema = z
  .string()
  .min(1, 'Email is required')
  .email('Please enter a valid email address')
  .toLowerCase()
  .trim();

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters');

// Strong password schema matching AuthPasswordStrengthIndicator requirements
export const strongPasswordSchema = z
  .string()
  .min(8, '8 characters or more')
  .regex(/[A-Z]/, 'At least 1 Uppercase letter')
  .regex(/\d/, 'At least 1 Number')
  .regex(/[!@#$%^&*()_+\-=[\]{};\\|,.<>/?]/, 'Special character (e.g. !?<>@#$%)');

export const signInFormSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export const signUpFormSchema = z.object({
  email: emailSchema,
  password: strongPasswordSchema,
});

// Keep backward compatibility - loginFormSchema is an alias for signInFormSchema
export const loginFormSchema = signInFormSchema;

export type SignInFormData = z.infer<typeof signInFormSchema>;
export type SignUpFormData = z.infer<typeof signUpFormSchema>;
export type LoginFormData = SignInFormData; // Backward compatibility
