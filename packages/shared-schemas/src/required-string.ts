import { z } from 'zod';

/**
 * A string schema that reports a missing value as "Required".
 *
 * zod 3 used "Required" for an absent field; zod 4 says "Invalid input: expected
 * string, received undefined". Auth clients have relied on the old wording
 * (e.g. "email: Required, password: Required" from POST /api/auth/sessions), so
 * the auth field schemas keep it. Other type errors keep zod's default message.
 *
 * Internal helper: not re-exported from the package index.
 */
export const requiredString = () =>
  z.string({ error: (issue) => (issue.input === undefined ? 'Required' : undefined) });
