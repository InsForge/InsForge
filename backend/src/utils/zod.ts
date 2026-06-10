import type { z, ZodTypeAny } from 'zod';
import { ERROR_CODES } from '@insforge/shared-schemas';
import { AppError } from '@/utils/errors.js';

type ZodIssueLike = {
  path: PropertyKey[];
  message: string;
};

type ZodErrorLike = {
  issues: ZodIssueLike[];
};

function formatZodIssues(error: ZodErrorLike): string {
  return error.issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : '(root)'}: ${issue.message}`)
    .join(', ');
}

export function invalidInputFromZod(error: ZodErrorLike): AppError {
  return new AppError(formatZodIssues(error), 400, ERROR_CODES.INVALID_INPUT);
}

export function parseZodSchema<TSchema extends ZodTypeAny>(
  schema: TSchema,
  value: unknown
): z.output<TSchema> {
  const validation = schema.safeParse(value);
  if (!validation.success) {
    throw invalidInputFromZod(validation.error);
  }

  return validation.data;
}
