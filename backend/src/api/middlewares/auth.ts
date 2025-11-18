import { Request, Response, NextFunction } from 'express';
import { AuthService } from '@/services/auth/auth.service.js';
import { AppError } from './error.js';
import { ERROR_CODES, NEXT_ACTION } from '@/types/error-constants.js';
import { verifyCloudToken } from '@/utils/cloud-token.js';
import { SecretService } from '@/services/secrets/secret.service.js';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
  };
  authenticated?: boolean;
  apiKey?: string;
  projectId?: string;
}

const authService = AuthService.getInstance();
const secretService = new SecretService();

// Helper function to extract Bearer token
function extractBearerToken(authHeader: string | undefined): string | null {
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
function setRequestUser(req: AuthRequest, payload: { sub: string; email: string; role: string }) {
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
    const payload = authService.verifyToken(token);

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
    const payload = authService.verifyToken(token);

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

    // Use helper function to verify cloud token
    const { projectId } = await verifyCloudToken(token);

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
