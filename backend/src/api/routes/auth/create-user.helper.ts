import { Request } from 'express';
import { roleSchema } from '@insforge/shared-schemas';
import { extractBearerToken } from '@/api/middlewares/auth.js';
import { TokenManager } from '@/infra/security/token.manager.js';
import logger from '@/utils/logger.js';

/**
 * Returns true when the request has a valid Bearer token with role project_admin.
 * Used to avoid overwriting admin session when admin creates a user (issue #808).
 */
export function isAdminCreatingUser(req: Request): boolean {
  try {
    const token = extractBearerToken(req.headers.authorization);
    if (!token) return false;
    const payload = TokenManager.getInstance().verifyToken(token);
    return payload?.role === roleSchema.enum.project_admin;
  } catch (error) {
    logger.debug('[Auth:CreateUser] Admin detection failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });
    return false;
  }
}
