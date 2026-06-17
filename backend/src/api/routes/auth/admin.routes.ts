import { Router, Request, Response, NextFunction } from 'express';
import { AuthService } from '@/services/auth/auth.service.js';
import { AuthRequest, verifyToken, verifyAdmin, requireRoot } from '@/api/middlewares/auth.js';
import { TokenManager } from '@/infra/security/token.manager.js';
import { AppError } from '@/utils/errors.js';
import { successResponse } from '@/utils/response.js';
import {
  ADMIN_REFRESH_TOKEN_COOKIE_NAME,
  setAdminRefreshTokenCookie,
  clearAdminRefreshTokenCookie,
} from '@/utils/cookies.js';
import {
  ERROR_CODES,
  createAdminSessionRequestSchema,
  exchangeAdminSessionRequestSchema,
  type CreateAdminSessionResponse,
  type GetCurrentAdminSessionResponse,
  createAdminSchema,
  changeAdminPasswordSchema,
} from '@insforge/shared-schemas';
import logger from '@/utils/logger.js';
import { appConfig } from '@/infra/config/app.config.js';

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
    const { refreshToken, csrfToken } = tokenManager.generateRefreshTokenWithCsrf(
      result.admin.sub,
      'admin'
    );
    setAdminRefreshTokenCookie(res, refreshToken);

    successResponse(res, { ...result, csrfToken });
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
    } else {
      logger.error('[Auth:AdminSessionExchange] Failed to exchange admin session', { error });
      next(new AppError('Failed to exchange admin session', 500, ERROR_CODES.INTERNAL_ERROR));
    }
  }
});

// POST /api/auth/admin/sessions - Create admin session (web only)
router.post('/sessions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validationResult = createAdminSessionRequestSchema.safeParse(req.body);
    if (!validationResult.success) {
      throw new AppError(
        validationResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const { username, password } = validationResult.data;
    const result: CreateAdminSessionResponse = await authService.adminLogin(username, password);

    // Set refresh token as httpOnly cookie + CSRF token for web clients
    const tokenManager = TokenManager.getInstance();
    const { refreshToken, csrfToken } = tokenManager.generateRefreshTokenWithCsrf(
      result.admin.sub,
      'admin'
    );
    setAdminRefreshTokenCookie(res, refreshToken);

    successResponse(res, { ...result, csrfToken });
  } catch (error) {
    next(error);
  }
});

// GET /api/auth/admin/sessions/current - Get current dashboard admin session
router.get(
  '/sessions/current',
  verifyToken,
  (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (req.user?.role !== 'project_admin' || !req.user.id) {
        throw new AppError('Admin access required', 403, ERROR_CODES.AUTH_UNAUTHORIZED);
      }

      const response: GetCurrentAdminSessionResponse = {
        admin: {
          sub: req.user.id,
        },
      };

      successResponse(res, response);
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/auth/admin/refresh - Refresh admin dashboard access token
router.post('/refresh', (req: Request, res: Response, next: NextFunction) => {
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

    const newAccessToken = tokenManager.generateAccessToken({
      sub: payload.sub,
      role: 'project_admin',
    });
    const { refreshToken: newRefreshToken, csrfToken: newCsrfToken } =
      tokenManager.generateRefreshTokenWithCsrf(payload.sub, 'admin', payload.csrfNonce);
    setAdminRefreshTokenCookie(res, newRefreshToken);

    successResponse(res, {
      admin: {
        sub: payload.sub,
      },
      accessToken: newAccessToken,
      csrfToken: newCsrfToken,
    });
  } catch (error) {
    if (error instanceof AppError && error.statusCode === 401) {
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

// GET /api/auth/admin - List all admins (root only)
router.get('/', requireRoot, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const admins = await authService.listAdmins();
    successResponse(res, { admins });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/admin - Create new admin (root only)
router.post('/', requireRoot, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const validation = createAdminSchema.safeParse(req.body);
    if (!validation.success) {
      throw new AppError(
        validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const { username, password } = validation.data;
    const admin = await authService.createAdmin(username, password, req.user?.id);
    successResponse(res, { admin }, 201);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/auth/admin/:username - Delete admin (root only, with self-deletion prevention)
router.delete(
  '/:username',
  requireRoot,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { username } = req.params;

      // Prevent self-deletion
      if (username === appConfig.auth.rootAdminUsername) {
        throw new AppError('Cannot delete root admin', 400, ERROR_CODES.FORBIDDEN);
      }

      await authService.deleteAdmin(username, req.user?.id || '');
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/auth/admin/change-password - Change own password (any admin)
router.post(
  '/change-password',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const validation = changeAdminPasswordSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(
          validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const username = req.user?.id;
      if (!username) {
        throw new AppError('Unauthorized', 401, ERROR_CODES.AUTH_UNAUTHORIZED);
      }

      const { oldPassword, newPassword } = validation.data;
      await authService.changeAdminPassword(username, oldPassword, newPassword);
      successResponse(res, { message: 'Password changed successfully' });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
