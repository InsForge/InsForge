import { Router, Request, Response, NextFunction } from 'express';
import { AuthService } from '@/services/auth/auth.service.js';
import { TokenManager } from '@/infra/security/token.manager.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { successResponse } from '@/utils/response.js';
import {
  ADMIN_REFRESH_TOKEN_COOKIE_NAME,
  setAdminRefreshTokenCookie,
  clearAdminRefreshTokenCookie,
} from '@/utils/cookies.js';
import {
  createAdminSessionRequestSchema,
  exchangeAdminSessionRequestSchema,
  type CreateAdminSessionResponse,
} from '@insforge/shared-schemas';
import logger from '@/utils/logger.js';

const router = Router();
const authService = AuthService.getInstance();

// POST /api/auth/admin/sessions/exchange - Exchange authorization code for admin session
router.post('/sessions/exchange', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validationResult = exchangeAdminSessionRequestSchema.safeParse(req.body);
    if (!validationResult.success) {
      throw new AppError(
        validationResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const { code } = validationResult.data;
    const result: CreateAdminSessionResponse =
      await authService.adminLoginWithAuthorizationCode(code);

    // Set refresh token as httpOnly cookie + CSRF token for web clients
    const tokenManager = TokenManager.getInstance();
    const refreshToken = tokenManager.generateRefreshToken(
      result.user.id,
      'admin',
      tokenManager.generateCsrfNonce()
    );
    const csrfToken = tokenManager.generateCsrfToken(tokenManager.verifyRefreshToken(refreshToken));
    setAdminRefreshTokenCookie(res, refreshToken);

    successResponse(res, { ...result, csrfToken });
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
    } else {
      // Convert other errors (like JWT verification errors) to 400
      next(
        new AppError(
          'Failed to exchange admin session' + (error instanceof Error ? `: ${error.message}` : ''),
          400,
          ERROR_CODES.INVALID_INPUT
        )
      );
    }
  }
});

// POST /api/auth/admin/sessions - Create admin session (web only)
router.post('/sessions', (req: Request, res: Response, next: NextFunction) => {
  try {
    const validationResult = createAdminSessionRequestSchema.safeParse(req.body);
    if (!validationResult.success) {
      throw new AppError(
        validationResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const { email, password } = validationResult.data;
    const result: CreateAdminSessionResponse = authService.adminLogin(email, password);

    // Set refresh token as httpOnly cookie + CSRF token for web clients
    const tokenManager = TokenManager.getInstance();
    const refreshToken = tokenManager.generateRefreshToken(
      result.user.id,
      'admin',
      tokenManager.generateCsrfNonce()
    );
    const csrfToken = tokenManager.generateCsrfToken(tokenManager.verifyRefreshToken(refreshToken));
    setAdminRefreshTokenCookie(res, refreshToken);

    successResponse(res, { ...result, csrfToken });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/admin/refresh - Refresh admin dashboard access token
// Uses a dashboard-specific httpOnly cookie + X-CSRF-Token header.
router.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tokenManager = TokenManager.getInstance();
    const refreshToken = req.cookies?.[ADMIN_REFRESH_TOKEN_COOKIE_NAME];

    if (!refreshToken) {
      throw new AppError('No admin refresh token provided', 401, ERROR_CODES.AUTH_UNAUTHORIZED);
    }

    const payload = tokenManager.verifyRefreshToken(refreshToken);
    if (payload.sessionType !== 'admin') {
      throw new AppError('Invalid admin refresh session type', 401, ERROR_CODES.AUTH_UNAUTHORIZED);
    }

    const csrfHeader = req.headers['x-csrf-token'] as string | undefined;
    if (!tokenManager.verifyCsrfToken(csrfHeader, payload)) {
      logger.warn('[Auth:AdminRefresh] CSRF token validation failed');
      throw new AppError('Invalid CSRF token', 403, ERROR_CODES.AUTH_UNAUTHORIZED);
    }

    const dbUser = await authService.getUserById(payload.sub);
    if (!dbUser || !dbUser.is_project_admin) {
      logger.warn('[Auth:AdminRefresh] Project admin not found for valid refresh token', {
        userId: payload.sub,
      });
      clearAdminRefreshTokenCookie(res);
      throw new AppError('Project admin not found', 401, ERROR_CODES.AUTH_UNAUTHORIZED);
    }

    const user = authService.transformUserRecordToSchema(dbUser);
    const newAccessToken = tokenManager.generateAccessToken({
      sub: user.id,
      email: user.email,
      role: 'project_admin',
    });
    const newRefreshToken = tokenManager.generateRefreshToken(user.id, 'admin', payload.csrfNonce);
    const newCsrfToken = tokenManager.generateCsrfToken(
      tokenManager.verifyRefreshToken(newRefreshToken)
    );
    setAdminRefreshTokenCookie(res, newRefreshToken);

    successResponse(res, {
      accessToken: newAccessToken,
      user,
      csrfToken: newCsrfToken,
    });
  } catch (error) {
    // Preserve the admin refresh cookie on CSRF rejection; a transient missing
    // header should not destroy the dashboard session.
    if (!(error instanceof AppError && error.statusCode === 403)) {
      clearAdminRefreshTokenCookie(res);
    }
    next(error);
  }
});

// POST /api/auth/admin/logout - Logout dashboard session
router.post('/logout', (_req: Request, res: Response, next: NextFunction) => {
  try {
    clearAdminRefreshTokenCookie(res);

    successResponse(res, {
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error) {
    next(error);
  }
});

export default router;
