import { Router, Request, Response, NextFunction } from 'express';
import { AuthService } from '@/services/auth/auth.service.js';
import { AuthConfigService } from '@/services/auth/auth-config.service.js';
import { OAuthConfigService } from '@/services/auth/oauth-config.service.js';
import { AuditService } from '@/services/logs/audit.service.js';
import { TokenManager } from '@/infra/security/token.manager.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { successResponse } from '@/utils/response.js';
import { AuthRequest, verifyAdmin, verifyToken } from '@/api/middlewares/auth.js';
import oauthRouter from './oauth.routes.js';
import { sendEmailOTPLimiter, verifyOTPLimiter } from '@/api/middlewares/rate-limiters.js';
import {
  REFRESH_TOKEN_COOKIE_NAME,
  CSRF_TOKEN_COOKIE_NAME,
  setRefreshTokenCookie,
  setCsrfTokenCookie,
  clearRefreshTokenCookie,
  clearCsrfTokenCookie,
  issueRefreshTokenCookie,
} from '@/utils/cookies.js';
import { CsrfManager } from '@/infra/security/csrf.manager.js';
import {
  userIdSchema,
  createUserRequestSchema,
  createSessionRequestSchema,
  createAdminSessionRequestSchema,
  deleteUsersRequestSchema,
  listUsersRequestSchema,
  sendVerificationEmailRequestSchema,
  verifyEmailRequestSchema,
  sendResetPasswordEmailRequestSchema,
  exchangeResetPasswordTokenRequestSchema,
  resetPasswordRequestSchema,
  type CreateUserResponse,
  type CreateSessionResponse,
  type VerifyEmailResponse,
  type ExchangeResetPasswordTokenResponse,
  type ResetPasswordResponse,
  type CreateAdminSessionResponse,
  type GetCurrentSessionResponse,
  type ListUsersResponse,
  type DeleteUsersResponse,
  type GetPublicAuthConfigResponse,
  exchangeAdminSessionRequestSchema,
  type GetAuthConfigResponse,
  updateAuthConfigRequestSchema,
} from '@insforge/shared-schemas';
import { SocketManager } from '@/infra/socket/socket.manager.js';
import { storeAuthorizationCode, consumeAuthorizationCode, verifyPkce } from '@/infra/security/pkce.manager.js';
import { DataUpdateResourceType, ServerEvents } from '@/types/socket.js';
import logger from '@/utils/logger.js';

const router = Router();
const authService = AuthService.getInstance();
const authConfigService = AuthConfigService.getInstance();
const oAuthConfigService = OAuthConfigService.getInstance();
const auditService = AuditService.getInstance();

// Mount OAuth routes
router.use('/oauth', oauthRouter);

/**
 * POST /api/auth/exchange - Exchange authorization code for access token
 * 
 * This endpoint is used to securely exchange an authorization code for an access token.
 * If PKCE was used during OAuth initiation, code_verifier must be provided.
 * 
 * Request body:
 * - code: string (required) - The authorization code from OAuth callback
 * - code_verifier: string (optional) - PKCE code verifier for verification
 * 
 * Response:
 * - accessToken: string
 * - user: object
 * - csrfToken: string (optional)
 */
router.post('/exchange', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code, code_verifier } = req.body;

    if (!code || typeof code !== 'string') {
      throw new AppError('code is required', 400, ERROR_CODES.INVALID_INPUT);
    }

    // Consume authorization code (one-time use)
    const sessionData = consumeAuthorizationCode(code);
    if (!sessionData) {
      throw new AppError('Invalid or expired authorization code', 401, ERROR_CODES.AUTH_UNAUTHORIZED);
    }

    // Verify PKCE if code_challenge was stored
    if (sessionData.codeChallenge) {
      if (!code_verifier || typeof code_verifier !== 'string') {
        throw new AppError('code_verifier is required for this authorization', 400, ERROR_CODES.INVALID_INPUT);
      }

      const isValid = await verifyPkce(code_verifier, sessionData.codeChallenge);
      if (!isValid) {
        logger.warn('PKCE verification failed');
        throw new AppError('PKCE verification failed', 401, ERROR_CODES.AUTH_UNAUTHORIZED);
      }
    }

    // Issue refresh token cookie
    const csrfToken = issueRefreshTokenCookie(res, sessionData.user);

    // Return access token and user data
    const response: CreateSessionResponse & { csrfToken?: string } = {
      accessToken: sessionData.accessToken,
      user: sessionData.user,
      csrfToken: csrfToken ?? undefined,
    };

    successResponse(res, response);
  } catch (error) {
    logger.error('Exchange endpoint error', {
      error: error instanceof Error ? error.message : error,
    });
    next(error);
  }
});

// Public Authentication Configuration Routes
// GET /api/auth/public-config - Get all public authentication configuration (public endpoint)
router.get('/public-config', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [oAuthProviders, authConfigs] = await Promise.all([
      oAuthConfigService.getConfiguredProviders(),
      authConfigService.getPublicAuthConfig(),
    ]);

    const response: GetPublicAuthConfigResponse = {
      oAuthProviders,
      ...authConfigs,
    };

    successResponse(res, response);
  } catch (error) {
    next(error);
  }
});

// Email Authentication Configuration Routes
// GET /api/auth/config - Get authentication configurations (admin only)
router.get('/config', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const config: GetAuthConfigResponse = await authConfigService.getAuthConfig();
    successResponse(res, config);
  } catch (error) {
    next(error);
  }
});

// PUT /api/auth/config - Update authentication configurations (admin only)
router.put('/config', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const validationResult = updateAuthConfigRequestSchema.safeParse(req.body);
    if (!validationResult.success) {
      throw new AppError(
        validationResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const input = validationResult.data;
    const config: GetAuthConfigResponse = await authConfigService.updateAuthConfig(input);

    await auditService.log({
      actor: req.user?.email || 'api-key',
      action: 'UPDATE_AUTH_CONFIG',
      module: 'AUTH',
      details: {
        updatedFields: Object.keys(input),
      },
      ip_address: req.ip,
    });

    successResponse(res, config);
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/users - Create a new user (registration)
// Supports PKCE: if code_challenge is provided, returns authorization code instead of access_token
router.post('/users', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validationResult = createUserRequestSchema.safeParse(req.body);
    if (!validationResult.success) {
      throw new AppError(
        validationResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const { email, password, name } = validationResult.data;
    const supportCode = req.body.support_code === true;
    const codeChallenge = req.body.code_challenge as string | undefined;
    
    const result: CreateUserResponse = await authService.register(email, password, name, {
      supportCode,
    });

    const socket = SocketManager.getInstance();
    socket.broadcastToRoom('role:project_admin', ServerEvents.DATA_UPDATE, {
      resource: DataUpdateResourceType.USERS,
    });

    // If code_challenge is provided, return authorization code for PKCE flow
    if (codeChallenge && result.accessToken && result.user) {
      const authorizationCode = storeAuthorizationCode({
        accessToken: result.accessToken,
        user: result.user,
        codeChallenge,
      });

      // Return authorization code instead of access_token
      successResponse(res, {
        code: authorizationCode,
        user: result.user,
      });
      return;
    }

    // Regular flow (direct SDK usage, no PKCE)
    // Set refresh token in httpOnly cookie and get CSRF token
    let csrfToken: string | null = null;
    if (result.accessToken && result.user) {
      csrfToken = issueRefreshTokenCookie(res, result.user);
    }

    successResponse(res, { ...result, csrfToken });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/sessions - Create a new session (login)
// Supports PKCE: if code_challenge is provided, returns authorization code instead of access_token
router.post('/sessions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validationResult = createSessionRequestSchema.safeParse(req.body);
    if (!validationResult.success) {
      throw new AppError(
        validationResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const { email, password } = validationResult.data;
    const supportCode = req.body.support_code === true;
    const codeChallenge = req.body.code_challenge as string | undefined;
    
    const result: CreateSessionResponse = await authService.login(email, password, { supportCode });

    // If code_challenge is provided, return authorization code for PKCE flow
    if (codeChallenge && result.accessToken && result.user) {
      const authorizationCode = storeAuthorizationCode({
        accessToken: result.accessToken,
        user: result.user,
        codeChallenge,
      });

      // Return authorization code instead of access_token
      successResponse(res, {
        code: authorizationCode,
        user: result.user,
      });
      return;
    }

    // Regular flow (direct SDK usage, no PKCE)
    // Set refresh token in httpOnly cookie and get CSRF token
    let csrfToken: string | null = null;
    if (result.accessToken && result.user) {
      csrfToken = issueRefreshTokenCookie(res, result.user);
    }

    successResponse(res, { ...result, csrfToken });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/refresh - Refresh access token using httpOnly cookie
// Requires X-CSRF-Token header for CSRF protection
router.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const refreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE_NAME];

    if (!refreshToken) {
      throw new AppError('No refresh token provided', 401, ERROR_CODES.AUTH_UNAUTHORIZED);
    }

    // Verify CSRF token to prevent CSRF attacks
    const csrfHeader = req.headers['x-csrf-token'] as string | undefined;
    const csrfCookie = req.cookies?.[CSRF_TOKEN_COOKIE_NAME];
    if (!CsrfManager.verify(csrfHeader, csrfCookie)) {
      logger.warn('[Auth:Refresh] CSRF token validation failed');
      throw new AppError('Invalid CSRF token', 403, ERROR_CODES.AUTH_UNAUTHORIZED);
    }

    const tokenManager = TokenManager.getInstance();

    // Verify the refresh token
    const payload = tokenManager.verifyRefreshToken(refreshToken);

    // Generate new access token
    const newAccessToken = tokenManager.generateToken({
      sub: payload.sub,
      email: payload.email,
      role: payload.role,
    });

    // Generate new refresh token (token rotation for security)
    const newRefreshToken = tokenManager.generateRefreshToken({
      sub: payload.sub,
      email: payload.email,
      role: payload.role,
    });

    // Set new refresh token cookie
    setRefreshTokenCookie(res, newRefreshToken);

    // Generate new CSRF token for the new refresh token
    const newCsrfToken = CsrfManager.generate(newRefreshToken);
    setCsrfTokenCookie(res, newCsrfToken);

    // Fetch user data for response
    const user = await authService.getUserSchemaById(payload.sub);

    if (!user) {
      logger.warn('[Auth:Refresh] User not found for valid refresh token', { userId: payload.sub });
      clearRefreshTokenCookie(res);
      clearCsrfTokenCookie(res);
      throw new AppError('User not found', 401, ERROR_CODES.AUTH_UNAUTHORIZED);
    }

    successResponse(res, {
      accessToken: newAccessToken,
      user: user,
      csrfToken: newCsrfToken,
    });
  } catch (error) {
    // Clear invalid cookie on error
    clearRefreshTokenCookie(res);
    clearCsrfTokenCookie(res);
    next(error);
  }
});

// POST /api/auth/logout - Logout and clear refresh token cookie
router.post('/logout', (_req: Request, res: Response, next: NextFunction) => {
  try {
    // Clear refresh token cookie
    clearRefreshTokenCookie(res);
    clearCsrfTokenCookie(res);

    successResponse(res, {
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/exchange - Exchange authorization code for access token
// This is the secure alternative to passing access_token in URL
// Used by: OAuth callback, email login, signup, email verification (when support_code=true)
router.post('/exchange', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code } = req.body;

    if (!code) {
      throw new AppError('Authorization code is required', 400, ERROR_CODES.INVALID_INPUT);
    }

    const tokenManager = TokenManager.getInstance();

    // Verify and decode the authorization code
    let payload: {
      userId: string;
      email: string;
      name?: string;
      role: string;
      type: string;
    };

    try {
      payload = tokenManager.verifyAuthCode(code);
    } catch {
      throw new AppError(
        'Invalid or expired authorization code',
        401,
        ERROR_CODES.AUTH_UNAUTHORIZED
      );
    }

    // Generate access token
    const accessToken = tokenManager.generateToken({
      sub: payload.userId,
      email: payload.email,
      role: 'authenticated',
    });

    // Generate and set refresh token
    const refreshToken = tokenManager.generateRefreshToken({
      sub: payload.userId,
      email: payload.email,
      role: 'authenticated',
    });
    setRefreshTokenCookie(res, refreshToken);

    // Get user data
    const user = await authService.getUserSchemaById(payload.userId);

    successResponse(res, {
      accessToken,
      user: user || {
        id: payload.userId,
        email: payload.email,
        name: payload.name || '',
      },
    });
  } catch (error) {
    logger.error('Auth code exchange error', { error });
    next(error);
  }
});

// POST /api/auth/admin/sessions/exchange - Create admin session
router.post('/admin/sessions/exchange', async (req: Request, res: Response, next: NextFunction) => {
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

    successResponse(res, result);
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

// POST /api/auth/admin/sessions - Create admin session
router.post('/admin/sessions', (req: Request, res: Response, next: NextFunction) => {
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

    successResponse(res, result);
  } catch (error) {
    next(error);
  }
});

// GET /api/auth/sessions/current - Get current session user
router.get(
  '/sessions/current',
  verifyToken,
  (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError('User not authenticated', 401, ERROR_CODES.AUTH_INVALID_CREDENTIALS);
      }

      const response: GetCurrentSessionResponse = {
        user: {
          id: req.user.id,
          email: req.user.email,
          role: req.user.role as 'authenticated' | 'project_admin',
        },
      };

      successResponse(res, response);
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/auth/users - List all users (admin only)
router.get('/users', verifyAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const queryValidation = listUsersRequestSchema.safeParse(req.query);
    const queryParams = queryValidation.success ? queryValidation.data : req.query;
    const { limit = '10', offset = '0', search } = queryParams || {};

    const parsedLimit = parseInt(limit as string);
    const parsedOffset = parseInt(offset as string);

    const { users, total } = await authService.listUsers(
      parsedLimit,
      parsedOffset,
      search as string | undefined
    );

    const response: ListUsersResponse = {
      data: users,
      pagination: {
        offset: parsedOffset,
        limit: parsedLimit,
        total: total,
      },
    };

    successResponse(res, response);
  } catch (error) {
    next(error);
  }
});

// GET /api/auth/users/:id - Get specific user (admin only)
router.get(
  '/users/:userId',
  verifyAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Validate userId path parameter directly
      const userIdValidation = userIdSchema.safeParse(req.params.userId);
      if (!userIdValidation.success) {
        throw new AppError('Invalid user ID format', 400, ERROR_CODES.INVALID_INPUT);
      }

      const userId = userIdValidation.data;
      const user = await authService.getUserSchemaById(userId);

      if (!user) {
        throw new AppError('User not found', 404, ERROR_CODES.NOT_FOUND);
      }

      successResponse(res, user);
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/auth/users - Delete users (batch operation, admin only)
router.delete(
  '/users',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const validationResult = deleteUsersRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        throw new AppError(
          validationResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const { userIds } = validationResult.data;

      const deletedCount = await authService.deleteUsers(userIds);

      // Log audit for user deletion
      await auditService.log({
        actor: req.user?.email || 'api-key',
        action: 'DELETE_USERS',
        module: 'AUTH',
        details: {
          userIds,
          deletedCount,
        },
        ip_address: req.ip,
      });

      const response: DeleteUsersResponse = {
        message: 'Users deleted successfully',
        deletedCount,
      };

      successResponse(res, response);
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/auth/tokens/anon - Generate anonymous JWT token (never expires)
router.post('/tokens/anon', verifyAdmin, (_req: Request, res: Response, next: NextFunction) => {
  try {
    const tokenManager = TokenManager.getInstance();
    const token = tokenManager.generateAnonToken();

    successResponse(res, {
      accessToken: token,
      message: 'Anonymous token generated successfully (never expires)',
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/email/send-verification - Send email verification (code or link based on config)
router.post(
  '/email/send-verification',
  sendEmailOTPLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validationResult = sendVerificationEmailRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        throw new AppError(
          validationResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const { email } = validationResult.data;

      // Get auth config to determine verification method
      const authConfig = await authConfigService.getAuthConfig();
      const method = authConfig.verifyEmailMethod;

      // Note: User enumeration is prevented at service layer
      // Service returns gracefully (no error) if user not found
      if (method === 'link') {
        await authService.sendVerificationEmailWithLink(email);
      } else {
        await authService.sendVerificationEmailWithCode(email);
      }

      // Always return 202 Accepted with generic message
      const message =
        method === 'link'
          ? 'If your email is registered, we have sent you a verification link. Please check your inbox.'
          : 'If your email is registered, we have sent you a verification code. Please check your inbox.';

      successResponse(
        res,
        {
          success: true,
          message,
        },
        202
      );
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/auth/email/verify - Verify email with OTP
// Uses verifyEmailMethod from auth config to determine verification type:
// - 'code': expects email + 6-digit numeric code
// - 'link': expects 64-char hex token only
// Supports PKCE: if code_challenge is provided, returns authorization code instead of access_token
router.post(
  '/email/verify',
  verifyOTPLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validationResult = verifyEmailRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        throw new AppError(
          validationResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const { email, otp } = validationResult.data;
      const supportCode = req.body.support_code === true;
      const codeChallenge = req.body.code_challenge as string | undefined;

      // Get auth config to determine verification method
      const authConfig = await authConfigService.getAuthConfig();
      const method = authConfig.verifyEmailMethod;

      let result: VerifyEmailResponse;

      if (method === 'link') {
        // Link verification: otp is 64-char hex token
        result = await authService.verifyEmailWithToken(otp, { supportCode });
      } else {
        // Code verification: requires email + 6-digit code
        if (!email) {
          throw new AppError(
            'Email is required for code verification',
            400,
            ERROR_CODES.INVALID_INPUT
          );
        }
        result = await authService.verifyEmailWithCode(email, otp, { supportCode });
      }

      // If code_challenge is provided, return authorization code for PKCE flow
      if (codeChallenge && result.accessToken && result.user) {
        const authorizationCode = storeAuthorizationCode({
          accessToken: result.accessToken,
          user: result.user,
          codeChallenge,
        });

        // Return authorization code instead of access_token
        successResponse(res, {
          code: authorizationCode,
          user: result.user,
          redirectTo: result.redirectTo,
        });
        return;
      }

      // Regular flow (direct SDK usage, no PKCE)
      // Set refresh token in httpOnly cookie and get CSRF token
      let csrfToken: string | null = null;
      if (result.accessToken && result.user) {
        csrfToken = issueRefreshTokenCookie(res, result.user);
      }

      // Include csrfToken in response for CSRF protection
      successResponse(res, { ...result, csrfToken });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/auth/email/send-reset-password - Send password reset (code or link based on config)
router.post(
  '/email/send-reset-password',
  sendEmailOTPLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validationResult = sendResetPasswordEmailRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        throw new AppError(
          validationResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const { email } = validationResult.data;

      // Get auth config to determine reset password method
      const authConfig = await authConfigService.getAuthConfig();
      const method = authConfig.resetPasswordMethod;

      // Note: User enumeration is prevented at service layer
      // Service returns gracefully (no error) if user not found
      if (method === 'link') {
        await authService.sendResetPasswordEmailWithLink(email);
      } else {
        await authService.sendResetPasswordEmailWithCode(email);
      }

      // Always return 202 Accepted with generic message
      const message =
        method === 'link'
          ? 'If your email is registered, we have sent you a password reset link. Please check your inbox.'
          : 'If your email is registered, we have sent you a password reset code. Please check your inbox.';

      successResponse(
        res,
        {
          success: true,
          message,
        },
        202
      );
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/auth/email/exchange-reset-password-token - Exchange reset password code for reset token
// Step 1 of two-step password reset flow: verify code → get reset token
// Only used when resetPasswordMethod is 'code'
router.post(
  '/email/exchange-reset-password-token',
  verifyOTPLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validationResult = exchangeResetPasswordTokenRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        throw new AppError(
          validationResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const { email, code } = validationResult.data;

      const result = await authService.exchangeResetPasswordToken(email, code);

      const response: ExchangeResetPasswordTokenResponse = {
        token: result.token,
        expiresAt: result.expiresAt.toISOString(),
      };

      successResponse(res, response);
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/auth/email/reset-password - Reset password with token
// Token can be:
// - Magic link token (from send-reset-password endpoint when method is 'link')
// - Reset token (from exchange-reset-password-token endpoint after code verification)
// Both use RESET_PASSWORD purpose and are verified the same way
// Flow:
//   Code: send-reset-password → exchange-reset-password-token → reset-password (with resetToken)
//   Link: send-reset-password → reset-password (with link token)
router.post(
  '/email/reset-password',
  verifyOTPLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validationResult = resetPasswordRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        throw new AppError(
          validationResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const { newPassword, otp } = validationResult.data;

      // Both magic link tokens and code-verified reset tokens use RESET_PASSWORD purpose
      const result: ResetPasswordResponse = await authService.resetPasswordWithToken(
        newPassword,
        otp
      );

      successResponse(res, result); // Return message with optional redirectTo
    } catch (error) {
      next(error);
    }
  }
);

export default router;
