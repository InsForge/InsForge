import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import type { RoleSchema } from '@insforge/shared-schemas';

const ALLOWED_DATABASE_ROLES = new Set<RoleSchema>(['anon', 'authenticated', 'project_admin']);

export function getSafeDatabaseRole(role: RoleSchema): RoleSchema {
  if (ALLOWED_DATABASE_ROLES.has(role)) {
    return role;
  }

  throw new AppError('Invalid database role', 400, ERROR_CODES.INVALID_INPUT);
}
