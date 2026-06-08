import { Request, Response, NextFunction } from 'express';
import { TokenManager } from '@/infra/security/token.manager.js';
import { AppError } from '@/utils/errors.js';
import { ERROR_CODES, type RoleSchema } from '@insforge/shared-schemas';
import { NEXT_ACTIONS } from '../../utils/next-actions.js';
import { SecretService } from '@/services/secrets/secret.service.js';
import { adminService } from '@/services/admin/admin.service.js';

export type UserContext = {
  /**
   * Always present at the API level: user UUID for authenticated, admin id
   * for project_admin, 'anonymous' for anon. Only the authenticated UUID is
   * a row-ownership identity; database boundaries (claims, owner columns)
   * gate on role === 'authenticated' so admin/anon labels never reach
   * uuid-typed claims or columns.
   */
  id: string;
  email?: string;
  role: RoleSchema;
  username?: string;
  isRoot?: boolean;
};

export interface AuthRequest extends Request {
  user?: UserContext;
  authenticated?: boolean;
  hasApiKey?: boolean;
  projectId?: string;
}

const tokenManager = TokenManager.getInstance();
const secretService = SecretService.getInstance();

// Helper function to extract Bearer token (exported for optional auth checks)
export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7);
}

// Helper function to extract API key from request
// Checks both Bearer token (if starts with 'ik_') and x-api-key header
export function extractApiKey(req: AuthRequest): string | null {
  const bearerToken = extractBearerToken(req.headers.authorization);
  if (bearerToken && bearerToken.startsWith('ik_')) {
    return bearerToken;
  }

  // Fall back to x-api-key header for backward compatibility
  if (req.headers['x-api-key']) {
    return req.headers['x-api-key'] as string;
  }

  return null;
}

// Helper function to extract the opaque anon key from a request
// The anon key travels in the Authorization header like every other client
// credential (Bearer anon_...); signed-in clients replace it with their JWT.
export function extractAnonKey(req: AuthRequest): string | null {
  const bearerToken = extractBearerToken(req.headers.authorization);
  if (bearerToken && bearerToken.startsWith('anon_')) {
    return bearerToken;
  }

  return null;
}

// Helper function to set user on request
function setRequestUser(
  req: AuthRequest,
  payload: { sub: string; email?: string; role: RoleSchema; username?: string; isRoot?: boolean }
) {
  req.user = {
    id: payload.sub,
    email: payload.email,
    role: payload.role,
    username: payload.username,
    isRoot: payload.isRoot,
  };
}

// Helper to extract admin info from token sub claim
// Token sub format: "local:username" or "cloud:userId"
function extractUsernameFromSub(sub: string): string | null {
  if (sub.startsWith('local:')) {
    return sub.substring(6);
  }
  return null;
}

/**
 * Verifies user authentication (accepts API keys, anon keys, and JWT tokens)
 *
 * All credentials travel in the Authorization header; dispatch is by shape,
 * never by falling back on failure:
 * - `ik_...` (Bearer or x-api-key) -> admin API key
 * - Bearer `anon_...` -> opaque anon key, `anon` role
 * - any other Bearer -> JWT (role claim decides admin/authenticated/legacy anon)
 *
 * Signed-out clients send the anon key as their Bearer credential; signing in
 * replaces it with the user JWT. Each branch fails closed: an invalid or
 * expired user JWT must return 401 (so SDK refresh flows trigger) — it must
 * never silently downgrade to anon.
 */
export async function verifyUser(req: AuthRequest, res: Response, next: NextFunction) {
  const apiKey = extractApiKey(req);
  if (apiKey) {
    return verifyApiKey(req, res, next);
  }

  const bearerToken = extractBearerToken(req.headers.authorization);
  if (bearerToken && bearerToken.startsWith('anon_')) {
    return verifyAnonKey(req, res, next);
  }

  // Anything else (including no credentials) goes through JWT verification,
  // which produces the canonical 401 when the header is missing or invalid
  return verifyToken(req, res, next);
}

/**
 * Verifies admin authentication (requires admin token)
 */
export async function verifyAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  const apiKey = extractApiKey(req);
  if (apiKey) {
    return verifyApiKey(req, res, next);
  }

  try {
    const token = extractBearerToken(req.headers.authorization);
    if (!token) {
      throw new AppError(
        'No admin token provided',
        401,
        ERROR_CODES.AUTH_INVALID_CREDENTIALS,
        NEXT_ACTIONS.CHECK_TOKEN
      );
    }

    // For admin, we use JWT tokens
    const payload = tokenManager.verifyToken(token);

    if (payload.role !== 'project_admin') {
      throw new AppError(
        'Admin access required',
        403,
        ERROR_CODES.AUTH_UNAUTHORIZED,
        NEXT_ACTIONS.CHECK_ADMIN_TOKEN
      );
    }

    // Extract username from sub (format: "local:username")
    const username = extractUsernameFromSub(payload.sub);
    let isRoot = false;

    if (username) {
      const admin = await adminService.getAdminByUsername(username);
      if (admin) {
        isRoot = admin.is_root || false;
      }
    }

    setRequestUser(req, {
      ...payload,
      username: username || undefined,
      isRoot,
    });
    next();
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
    } else {
      next(
        new AppError(
          'Invalid admin token',
          401,
          ERROR_CODES.AUTH_INVALID_CREDENTIALS,
          NEXT_ACTIONS.CHECK_ADMIN_TOKEN
        )
      );
    }
  }
}

/**
 * Verifies that the authenticated admin has root privileges
 * Must be used after verifyAdmin
 */
export function requireRoot(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return next(
      new AppError(
        'Authentication required',
        401,
        ERROR_CODES.AUTH_UNAUTHORIZED,
        NEXT_ACTIONS.CHECK_TOKEN
      )
    );
  }

  if (req.user.role !== 'project_admin') {
    return next(
      new AppError(
        'Admin access required',
        403,
        ERROR_CODES.AUTH_UNAUTHORIZED,
        NEXT_ACTIONS.CHECK_ADMIN_TOKEN
      )
    );
  }

  if (!req.user.isRoot) {
    return next(
      new AppError(
        'Root admin access required',
        403,
        ERROR_CODES.AUTH_UNAUTHORIZED,
        NEXT_ACTIONS.CHECK_ADMIN_TOKEN
      )
    );
  }

  next();
}

/**
 * Verifies API key authentication
 * Accepts API key via Authorization: Bearer header or x-api-key header (backward compatibility)
 */
export async function verifyApiKey(req: AuthRequest, _res: Response, next: NextFunction) {
  try {
    // Extract API key from request using helper
    const apiKey = extractApiKey(req);

    if (!apiKey) {
      throw new AppError(
        'No API key provided',
        401,
        ERROR_CODES.AUTH_INVALID_API_KEY,
        NEXT_ACTIONS.CHECK_API_KEY
      );
    }

    const isValid = await secretService.verifyApiKey(apiKey);
    if (!isValid) {
      throw new AppError(
        'Invalid API key',
        401,
        ERROR_CODES.AUTH_INVALID_API_KEY,
        NEXT_ACTIONS.CHECK_API_KEY
      );
    }
    req.authenticated = true;
    req.hasApiKey = true;
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Verifies the opaque anon key (`anon_...`)
 * Maps the request to the `anon` role; RLS policies are the security boundary.
 * The request carries 'anonymous' as its API-level subject, but no sub claim
 * reaches the database (stripped like admin subjects), so auth.uid() is NULL
 * and identity-scoped policies fail closed.
 */
export async function verifyAnonKey(req: AuthRequest, _res: Response, next: NextFunction) {
  try {
    const anonKey = extractAnonKey(req);

    if (!anonKey) {
      throw new AppError(
        'No anon key provided',
        401,
        ERROR_CODES.AUTH_INVALID_CREDENTIALS,
        NEXT_ACTIONS.CHECK_TOKEN
      );
    }

    const isValid = await secretService.verifyAnonKey(anonKey);
    if (!isValid) {
      throw new AppError(
        'Invalid anon key',
        401,
        ERROR_CODES.AUTH_INVALID_CREDENTIALS,
        NEXT_ACTIONS.CHECK_TOKEN
      );
    }

    setRequestUser(req, { sub: 'anonymous', role: 'anon' });
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Core token verification middleware that handles JWT tokens
 * Sets req.user with the authenticated user information
 */
export function verifyToken(req: AuthRequest, _res: Response, next: NextFunction) {
  try {
    const token = extractBearerToken(req.headers.authorization);
    if (!token) {
      throw new AppError(
        'No token provided',
        401,
        ERROR_CODES.AUTH_INVALID_CREDENTIALS,
        NEXT_ACTIONS.CHECK_TOKEN
      );
    }

    // Verify JWT token
    const payload = tokenManager.verifyToken(token);

    // Validate token has a role
    if (!payload.role) {
      throw new AppError(
        'Invalid token: missing role',
        401,
        ERROR_CODES.AUTH_INVALID_CREDENTIALS,
        NEXT_ACTIONS.CHECK_TOKEN
      );
    }

    // Set user info on request
    setRequestUser(req, payload);

    next();
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
    } else {
      next(
        new AppError(
          'Invalid token',
          401,
          ERROR_CODES.AUTH_INVALID_CREDENTIALS,
          NEXT_ACTIONS.CHECK_TOKEN
        )
      );
    }
  }
}

/**
 * Verifies JWT token from cloud backend (api.insforge.dev)
 * Validates signature using JWKS and checks project_id claim
 */
export async function verifyCloudBackend(req: AuthRequest, _res: Response, next: NextFunction) {
  try {
    const token = extractBearerToken(req.headers.authorization);
    if (!token) {
      throw new AppError(
        'No authorization token provided',
        401,
        ERROR_CODES.AUTH_INVALID_CREDENTIALS,
        NEXT_ACTIONS.CHECK_TOKEN
      );
    }

    // Use TokenManager to verify cloud token
    const { projectId } = await tokenManager.verifyCloudToken(token);

    // Set project_id on request for use in route handlers
    req.projectId = projectId;
    req.authenticated = true;

    next();
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
    } else {
      next(
        new AppError(
          'Invalid cloud backend token',
          401,
          ERROR_CODES.AUTH_INVALID_CREDENTIALS,
          NEXT_ACTIONS.CHECK_TOKEN
        )
      );
    }
  }
}
