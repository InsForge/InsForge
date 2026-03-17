import { z } from 'zod';

export const guardedValueFlag = '__GuardedValue';
export const guardedValueDisplayText = 'data too large to show';

export const guardedValueSchema = z.object({
  [guardedValueFlag]: z.literal(true),
  message: z.string(),
});

export type GuardedValue = z.infer<typeof guardedValueSchema>;

export function isGuardedValue(value: unknown): value is GuardedValue {
  return guardedValueSchema.safeParse(value).success;
}
