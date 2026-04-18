import { Request, Response, NextFunction } from 'express';
import { TokenManager } from '@/infra/security/token.manager.js';
import { AppError } from './error.js';
import { ERROR_CODES, NEXT_ACTION } from '@/types/error-constants.js';
import { SecretService } from '@/services/secrets/secret.service.js';
import { RoleSchema } from '@insforge/shared-schemas';
import {
  getTrialKeyVerifier,
  isAgentKey,
  TrialContext,
  TrialKeyVerifier,
} from '@/services/auth/trial-key-verifier.js';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: RoleSchema;
  };
  authenticated?: boolean;
  apiKey?: string;
  projectId?: string;
  /**
   * Present when the request authenticated via an `ins_agent_trial_sk_*` or
   * `ins_agent_sk_*` bearer. Populated by `verifyAdminOrTrialAgent`; downstream
   * middleware / handlers read it for quota enforcement and claim_url generation.
   * Spec: docs/superpowers/specs/2026-04-18-deploy-trial-key-auth.md
   */
  trial?: TrialContext;
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

// Helper function to set user on request
function setRequestUser(
  req: AuthRequest,
  payload: { sub: string; email: string; role: RoleSchema }
) {
  req.user = {
    id: payload.sub,
    email: payload.email,
    role: payload.role,
  };
}

/**
 * Verifies user authentication (accepts both user and admin tokens)
 */
export async function verifyUser(req: AuthRequest, res: Response, next: NextFunction) {
  const apiKey = extractApiKey(req);
  if (apiKey) {
    return verifyApiKey(req, res, next);
  }

  // Use the main verifyToken that handles JWT authentication
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
        NEXT_ACTION.CHECK_TOKEN
      );
    }

    // For admin, we use JWT tokens
    const payload = tokenManager.verifyToken(token);

    if (payload.role !== 'project_admin') {
      throw new AppError(
        'Admin access required',
        403,
        ERROR_CODES.AUTH_UNAUTHORIZED,
        NEXT_ACTION.CHECK_ADMIN_TOKEN
      );
    }

    setRequestUser(req, payload);
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
          NEXT_ACTION.CHECK_ADMIN_TOKEN
        )
      );
    }
  }
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
        NEXT_ACTION.CHECK_API_KEY
      );
    }

    const isValid = await secretService.verifyApiKey(apiKey);
    if (!isValid) {
      throw new AppError(
        'Invalid API key',
        401,
        ERROR_CODES.AUTH_INVALID_API_KEY,
        NEXT_ACTION.CHECK_API_KEY
      );
    }
    req.authenticated = true;
    req.apiKey = apiKey;
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
        NEXT_ACTION.CHECK_TOKEN
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
        NEXT_ACTION.CHECK_TOKEN
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
          NEXT_ACTION.CHECK_TOKEN
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
        NEXT_ACTION.CHECK_TOKEN
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
          NEXT_ACTION.CHECK_TOKEN
        )
      );
    }
  }
}

/**
 * Accepts admin JWT / `ik_*` API key (legacy) OR agent-issued trial keys
 * (`ins_agent_trial_sk_*`) / post-upgrade user-agent keys (`ins_agent_sk_*`).
 *
 * On agent-key bearer:
 *   - Verified via `TrialKeyVerifier` against cloud-backend's
 *     `POST /internal/v1/verify-agent-key` endpoint (DB-separated; HMAC-signed).
 *   - Sets `req.trial` with {tier, projectId, organizationId, quota, expiresAt, …}.
 *   - Does NOT set `req.user` — deploy handlers that log `req.user?.email` already
 *     gracefully degrade to `'api-key'`.
 *
 * On admin JWT / `ik_` bearer: falls through to the existing `verifyAdmin`
 * behavior — zero change for non-agent callers.
 *
 * Spec: docs/superpowers/specs/2026-04-18-deploy-trial-key-auth.md
 */
export function verifyAdminOrTrialAgent(verifierOverride?: TrialKeyVerifier) {
  return async function handler(req: AuthRequest, res: Response, next: NextFunction) {
    const token = extractBearerToken(req.headers.authorization);
    if (token && isAgentKey(token)) {
      const verifier = verifierOverride ?? getTrialKeyVerifier();
      try {
        const context = await verifier.verify(token);
        if (!context) {
          return next(
            new AppError(
              'Invalid or expired agent key',
              401,
              ERROR_CODES.AUTH_INVALID_CREDENTIALS,
              NEXT_ACTION.CHECK_TOKEN
            )
          );
        }
        req.trial = context;
        req.authenticated = true;
        return next();
      } catch (error) {
        return next(
          error instanceof AppError
            ? error
            : new AppError(
                'Agent key verification failed',
                401,
                ERROR_CODES.AUTH_INVALID_CREDENTIALS,
                NEXT_ACTION.CHECK_TOKEN
              )
        );
      }
    }
    return verifyAdmin(req, res, next);
  };
}
