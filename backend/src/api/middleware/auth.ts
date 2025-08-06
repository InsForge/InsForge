import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthService } from '@/core/auth/auth.js';
import { AppError } from './error.js';
import { ERROR_CODES, NEXT_ACTION } from '@/types/error-constants.js';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    type?: 'user' | 'admin';
  };
  authenticated?: boolean;
  apiKey?: string;
}

const authService = AuthService.getInstance();

// Helper function to extract Bearer token
function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7);
}

// Helper function to set user on request
function setRequestUser(
  req: AuthRequest,
  payload: { sub: string; email: string; type: 'user' | 'admin' }
) {
  req.user = {
    id: payload.sub,
    email: payload.email,
    type: payload.type,
  };
}

export async function verifyUser(req: AuthRequest, res: Response, next: NextFunction) {
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

    let payload;

    if (process.env.ENABLE_BETTER_AUTH === 'true') {
      // Better Auth: verify session token and get JWT
      payload = await authService.verifyBetterAuthUserSessionToken(token);
    } else {
      // Legacy auth: direct JWT verification
      payload = authService.verifyToken(token);
    }

    if (payload.type !== 'user') {
      throw new AppError(
        'Invalid token type',
        401,
        ERROR_CODES.AUTH_INVALID_CREDENTIALS,
        NEXT_ACTION.CHECK_TOKEN
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
          'Invalid token',
          401,
          ERROR_CODES.AUTH_INVALID_CREDENTIALS,
          NEXT_ACTION.CHECK_TOKEN
        )
      );
    }
  }
}

export function verifyAdmin(req: AuthRequest, res: Response, next: NextFunction) {
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

    const payload = authService.verifyToken(token);
    if (payload.type !== 'admin') {
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

export async function verifyApiKey(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const apiKey = req.headers['x-api-key'] as string;
    if (!apiKey) {
      throw new AppError(
        'No API key provided',
        401,
        ERROR_CODES.AUTH_INVALID_API_KEY,
        NEXT_ACTION.CHECK_API_KEY
      );
    }

    const isValid = await authService.verifyApiKey(apiKey);
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

export async function verifyUserOrAdmin(req: AuthRequest, res: Response, next: NextFunction) {
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

    let payload;
    let isBetterAuthToken = false;
    if (process.env.ENABLE_BETTER_AUTH === 'true') {
      // Try Better Auth first (session token -> JWT exchange)
      try {
        payload = await authService.verifyBetterAuthUserSessionToken(token);
        isBetterAuthToken = true;
      } catch {
        // Fall back to legacy auth (direct JWT verification), this is used for admin auth
        payload = authService.verifyToken(token);
      }
    } else {
      // Legacy auth only
      payload = authService.verifyToken(token);
    }

    // Validate token type, this will get deleted and changed to "role"
    if (payload.type !== 'user' && payload.type !== 'admin') {
      throw new AppError(
        'Invalid token type',
        401,
        ERROR_CODES.AUTH_INVALID_CREDENTIALS,
        NEXT_ACTION.CHECK_TOKEN
      );
    }

    // Set user info on request
    setRequestUser(req, payload);

    // Generate PostgREST-compatible token if needed
    // Better Auth tokens are EdDSA-signed; PostgREST needs HS256
    if (isBetterAuthToken) {
      const postgrestToken = jwt.sign(
        {
          sub: payload.sub,
          email: payload.email,
          type: payload.type,
          role: payload.role,
        },
        process.env.JWT_SECRET || '',
        // TODO: Add a way to configure the token expiration time and refresh token
        { algorithm: 'HS256', expiresIn: '7d' }
      );
      (req as Request & { postgrestToken: string }).postgrestToken = postgrestToken;
    } else {
      // Legacy tokens are already HS256-signed, use as-is
      (req as Request & { postgrestToken: string }).postgrestToken = token;
    }

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

export async function verifyUserOrApiKey(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const apiKey = req.headers['x-api-key'] as string;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    return await verifyUserOrAdmin(req, res, next);
  } else if (apiKey) {
    return await verifyApiKey(req, res, next);
  } else {
    next(
      new AppError(
        'No authentication provided',
        401,
        ERROR_CODES.AUTH_INVALID_CREDENTIALS,
        NEXT_ACTION.CHECK_TOKEN
      )
    );
  }
}
