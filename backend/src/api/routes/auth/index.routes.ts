import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthService } from '@/services/auth/auth.service.js';
import { AuthConfigService } from '@/services/auth/auth-config.service.js';
import { AuthOTPService, OTPPurpose } from '@/services/auth/auth-otp.service.js';
import { AuditService } from '@/services/logs/audit.service.js';
import { TokenManager } from '@/infra/security/token.manager.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { successResponse } from '@/utils/response.js';
import {
  AuthRequest,
  verifyAdmin,
  verifyToken,
  extractBearerToken,
} from '@/api/middlewares/auth.js';
import oauthRouter from './oauth.routes.js';
import customOAuthRouter from './custom-oauth.routes.js';
import { sendEmailOTPLimiter, verifyOTPLimiter } from '@/api/middlewares/rate-limiters.js';
import {
  REFRESH_TOKEN_COOKIE_NAME,
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
} from '@/utils/cookies.js';
import { parseClientType } from '@/utils/utils.js';
import {
  userIdSchema,
  createUserRequestSchema,
  createSessionRequestSchema,
  createAdminSessionRequestSchema,
  refreshSessionRequestSchema,
  deleteUsersRequestSchema,
  listUsersRequestSchema,
  sendVerificationEmailRequestSchema,
  verifyEmailRequestSchema,
  sendResetPasswordEmailRequestSchema,
  exchangeResetPasswordTokenRequestSchema,
  resetPasswordRequestSchema,
  updateProfileRequestSchema,
  type CreateUserResponse,
  type CreateSessionResponse,
  type VerifyEmailResponse,
  type ExchangeResetPasswordTokenResponse,
  type ResetPasswordResponse,
  type CreateAdminSessionResponse,
  type GetCurrentSessionResponse,
  type GetProfileResponse,
  type ListUsersResponse,
  type DeleteUsersResponse,
  type GetPublicAuthConfigResponse,
  exchangeAdminSessionRequestSchema,
  type GetAuthConfigResponse,
  updateAuthConfigRequestSchema,
  upsertSmtpConfigRequestSchema,
  upsertResendConfigRequestSchema,
  updateEmailTemplateRequestSchema,
} from '@insforge/shared-schemas';
import { SmtpConfigService } from '@/services/email/smtp-config.service.js';
import { ResendConfigService } from '@/services/email/resend-config.service.js';
import { EmailTemplateService } from '@/services/email/email-template.service.js';
import { EMAIL_TEMPLATE_TYPES, type EmailTemplate } from '@/types/email.js';
import { SocketManager } from '@/infra/socket/socket.manager.js';
import { DataUpdateResourceType, ServerEvents } from '@/types/socket.js';
import logger from '@/utils/logger.js';

const router = Router();
const authService = AuthService.getInstance();
const authConfigService = AuthConfigService.getInstance();
const authOTPService = AuthOTPService.getInstance();
const auditService = AuditService.getInstance();
const smtpConfigService = SmtpConfigService.getInstance();
const resendConfigService = ResendConfigService.getInstance();
const emailTemplateService = EmailTemplateService.getInstance();

const emailLinkRequestSchema = z.object({
  token: z.string().regex(/^[a-fA-F0-9]{64}$/, 'token must be a 64-character hexadecimal token'),
});

function buildRedirectUrl(baseUrl: string, params: Record<string, string>): string {
  const url = new URL(baseUrl);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return url.toString();
}

// Mount OAuth routes
router.use('/oauth/custom', customOAuthRouter);
router.use('/oauth', oauthRouter);

// GET /api/auth/email/verify-link - Browser-based link verification flow
// This endpoint is meant for email clicks. It verifies the link token on the backend
// and then redirects the browser to the stored, validated redirectTo URL.
// POST /api/auth/email/verify below remains the JSON API for OTP/code submissions.
router.get('/email/verify-link', async (req: Request, res: Response, next: NextFunction) => {
  let redirectTo: string | null | undefined;
  try {
    const validationResult = emailLinkRequestSchema.safeParse(req.query);
    if (!validationResult.success) {
      throw new AppError(
        validationResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const { token } = validationResult.data;
    const context = await authOTPService.getEmailOTPContextByToken(OTPPurpose.VERIFY_EMAIL, token);
    redirectTo = context.redirectTo;

    if (!redirectTo) {
      throw new AppError(
        'No redirect target configured for this verification link',
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    if (!(await authConfigService.validateRedirectUrl(redirectTo))) {
      throw new AppError(
        `${redirectTo} is not in the allowed redirect URLs`,
        400,
        ERROR_CODES.INVALID_INPUT,
        'Please add this URL to the allowed redirect URLs in the authentication configuration.'
      );
    }

    await authService.verifyEmailWithToken(token);

    return res.redirect(
      buildRedirectUrl(redirectTo, {
        insforge_status: 'success',
        insforge_type: 'verify_email',
      })
    );
  } catch (error) {
    if (redirectTo) {
      try {
        if (await authConfigService.validateRedirectUrl(redirectTo)) {
          const message = error instanceof Error ? error.message : 'Authentication action failed';
          return res.redirect(
            buildRedirectUrl(redirectTo, {
              insforge_status: 'error',
              insforge_type: 'verify_email',
              insforge_error: message,
            })
          );
        }
      } catch {
        // Fall back to the standard error handler if redirect generation fails.
      }
    }

    next(error);
  }
});

// GET /api/auth/email/reset-password-link - Browser-based link reset flow
// This endpoint is meant for email clicks. It validates the link token on the backend
// and then redirects the browser to the stored, validated redirectTo URL.
// POST /api/auth/email/reset-password below remains the JSON API that accepts a new password.
router.get(
  '/email/reset-password-link',
  async (req: Request, res: Response, next: NextFunction) => {
    let redirectTo: string | null | undefined;

    try {
      const validationResult = emailLinkRequestSchema.safeParse(req.query);
      if (!validationResult.success) {
        throw new AppError(
          validationResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const { token } = validationResult.data;
      const context = await authOTPService.getEmailOTPContextByToken(
        OTPPurpose.RESET_PASSWORD,
        token
      );
      redirectTo = context.redirectTo;

      if (!redirectTo) {
        throw new AppError(
          'No redirect target configured for this reset link',
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      if (!(await authConfigService.validateRedirectUrl(redirectTo))) {
        throw new AppError(
          `${redirectTo} is not in the allowed redirect URLs`,
          400,
          ERROR_CODES.INVALID_INPUT,
          'Please add this URL to the allowed redirect URLs in the authentication configuration.'
        );
      }

      return res.redirect(
        buildRedirectUrl(redirectTo, {
          token,
          insforge_status: 'ready',
          insforge_type: 'reset_password',
        })
      );
    } catch (error) {
      if (redirectTo) {
        try {
          if (await authConfigService.validateRedirectUrl(redirectTo)) {
            const message = error instanceof Error ? error.message : 'Authentication action failed';
            return res.redirect(
              buildRedirectUrl(redirectTo, {
                insforge_status: 'error',
                insforge_type: 'reset_password',
                insforge_error: message,
              })
            );
          }
        } catch {
          // Fall back to the standard error handler if redirect generation fails.
        }
      }

      next(error);
    }
  }
);

// Public Authentication Configuration Routes
// GET /api/auth/public-config - Get all public authentication configuration (public endpoint)
router.get('/public-config', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const response: GetPublicAuthConfigResponse = await authService.getMetadata();

    successResponse(res, response);
  } catch (error) {
    next(error);
  }
});

// PATCH /api/auth/profiles/current - Update current user's profile (authenticated)
router.patch(
  '/profiles/current',
  verifyToken,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError('User not authenticated', 401, ERROR_CODES.AUTH_INVALID_CREDENTIALS);
      }

      const validationResult = updateProfileRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        throw new AppError(
          validationResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const { profile } = validationResult.data;
      const result = await authService.updateProfile(req.user.id, profile);

      const response: GetProfileResponse = result;

      successResponse(res, response);
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/auth/profiles/:userId - Get user profile by ID (public endpoint)
router.get('/profiles/:userId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userIdValidation = userIdSchema.safeParse(req.params.userId);
    if (!userIdValidation.success) {
      throw new AppError('Invalid user ID format', 400, ERROR_CODES.INVALID_INPUT);
    }

    const userId = userIdValidation.data;
    const userProfile = await authService.getProfileById(userId);

    if (!userProfile) {
      throw new AppError('User not found', 404, ERROR_CODES.NOT_FOUND);
    }

    const response: GetProfileResponse = userProfile;

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

// POST /api/auth/users - Create a new user (registration or admin adding user)
// Query params: client_type (optional) - 'web' (default), 'mobile', 'desktop', or 'server'
// When called with a valid admin token (e.g. dashboard adding a user), we do NOT set session
// cookie or return csrf/refresh tokens, so the admin's session is not overwritten.
router.post('/users', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clientType = parseClientType(req.query.client_type);
    let adminCreatingUser = false;

    try {
      const token = extractBearerToken(req.headers.authorization);
      if (token) {
        const payload = TokenManager.getInstance().verifyToken(token);
        adminCreatingUser = payload?.role === 'project_admin';
      }
    } catch (error) {
      // Not a valid token; treat as normal registration.
      logger.debug('[Auth:CreateUser] Admin detection failed', {
        error: error instanceof Error ? error.message : 'unknown',
      });
    }

    const validationResult = createUserRequestSchema.safeParse(req.body);
    if (!validationResult.success) {
      throw new AppError(
        validationResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const {
      email,
      password,
      name,
      redirectTo,
      autoConfirm: bodyAutoConfirm,
    } = validationResult.data;
    const autoConfirm = adminCreatingUser ? bodyAutoConfirm : false;
    const result: CreateUserResponse = await authService.register(
      email,
      password,
      name,
      redirectTo,
      { isAdminCreation: adminCreatingUser, autoConfirm }
    );

    // Set refresh token based on client type (skip when admin is adding a user)
    if (result.accessToken && result.user && !adminCreatingUser) {
      const tokenManager = TokenManager.getInstance();
      const refreshToken = tokenManager.generateRefreshToken(result.user.id);

      if (clientType === 'web') {
        // Web clients: use httpOnly cookie + CSRF token
        setRefreshTokenCookie(res, refreshToken);
        result.csrfToken = tokenManager.generateCsrfToken(refreshToken);
      } else {
        // Non-web clients (mobile, desktop, server): return refresh token in response body.
        // Server clients cannot rely on browser cookies, so they follow the native-app flow.
        result.refreshToken = refreshToken;
      }
    }

    const socket = SocketManager.getInstance();
    socket.broadcastToRoom(
      'role:project_admin',
      ServerEvents.DATA_UPDATE,
      { resource: DataUpdateResourceType.USERS },
      'system'
    );

    successResponse(res, result);
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/sessions - Create a new session (login)
// Query params: client_type (optional) - 'web' (default), 'mobile', 'desktop', or 'server'
router.post('/sessions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clientType = parseClientType(req.query.client_type);

    const validationResult = createSessionRequestSchema.safeParse(req.body);
    if (!validationResult.success) {
      throw new AppError(
        validationResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const { email, password } = validationResult.data;
    const result: CreateSessionResponse = await authService.login(email, password);

    // Set refresh token based on client type
    const tokenManager = TokenManager.getInstance();
    const refreshToken = tokenManager.generateRefreshToken(result.user.id);

    if (clientType === 'web') {
      // Web clients: use httpOnly cookie + CSRF token
      setRefreshTokenCookie(res, refreshToken);
      result.csrfToken = tokenManager.generateCsrfToken(refreshToken);
    } else {
      // Non-web clients (mobile, desktop, server): return refresh token in response body.
      // Server clients cannot rely on browser cookies, so they follow the native-app flow.
      result.refreshToken = refreshToken;
    }

    successResponse(res, result);
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/id-token - Sign in with ID token from native SDK (Google One Tap, etc.)
// Query params: client_type (optional) - 'web' (default), 'mobile', 'desktop', or 'server'
router.post('/id-token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clientType = parseClientType(req.query.client_type);

    const { provider, token } = req.body;

    // Validate input
    if (!provider || typeof provider !== 'string') {
      throw new AppError('Provider is required', 400, ERROR_CODES.INVALID_INPUT);
    }

    if (provider !== 'google') {
      throw new AppError(
        `Provider ${provider} is not supported for ID token sign-in. Supported: google`,
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    if (!token || typeof token !== 'string') {
      throw new AppError('Token is required', 400, ERROR_CODES.INVALID_INPUT);
    }

    // Sign in with ID token
    const result: CreateSessionResponse = await authService.signInWithIdToken(provider, token);

    // Set refresh token based on client type
    const tokenManager = TokenManager.getInstance();
    const refreshToken = tokenManager.generateRefreshToken(result.user.id);

    if (clientType === 'web') {
      // Web clients: use httpOnly cookie + CSRF token
      setRefreshTokenCookie(res, refreshToken);
      result.csrfToken = tokenManager.generateCsrfToken(refreshToken);
    } else {
      // Non-web clients (mobile, desktop, server): return refresh token in response body.
      // Server clients cannot rely on browser cookies, so they follow the native-app flow.
      result.refreshToken = refreshToken;
    }

    successResponse(res, result);
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/refresh - Refresh access token
// Query params: client_type (optional) - 'web' (default), 'mobile', 'desktop', or 'server'
// Web clients: uses httpOnly cookie + X-CSRF-Token header
// Non-web clients (mobile, desktop, server): use refreshToken in request body
router.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
  const clientType = parseClientType(req.query.client_type);

  try {
    const tokenManager = TokenManager.getInstance();

    let refreshToken: string | undefined;

    if (clientType === 'web') {
      // Web clients: get refresh token from cookie
      refreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE_NAME];

      if (!refreshToken) {
        throw new AppError('No refresh token provided', 401, ERROR_CODES.AUTH_UNAUTHORIZED);
      }

      // Verify CSRF token by re-computing from refresh token (web only)
      const csrfHeader = req.headers['x-csrf-token'] as string | undefined;
      if (!tokenManager.verifyCsrfToken(csrfHeader, refreshToken)) {
        logger.warn('[Auth:Refresh] CSRF token validation failed');
        throw new AppError('Invalid CSRF token', 403, ERROR_CODES.AUTH_UNAUTHORIZED);
      }
    } else {
      // Non-web clients (mobile, desktop, server): get refresh token from request body.
      // This includes trusted server-side callers that store the token outside the browser.
      const normalizedRefreshRequest = {
        refreshToken: req.body?.refreshToken ?? req.body?.refresh_token,
      };
      const validationResult = refreshSessionRequestSchema.safeParse(normalizedRefreshRequest);

      if (!validationResult.success) {
        throw new AppError(
          validationResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      refreshToken = validationResult.data.refreshToken;
    }

    const payload = tokenManager.verifyRefreshToken(refreshToken);

    // Fetch current user data from DB (raw record includes is_project_admin)
    const dbUser = await authService.getUserById(payload.sub);

    if (!dbUser) {
      logger.warn('[Auth:Refresh] User not found for valid refresh token', { userId: payload.sub });
      if (clientType === 'web') {
        clearRefreshTokenCookie(res);
      }
      throw new AppError('User not found', 401, ERROR_CODES.AUTH_UNAUTHORIZED);
    }

    const user = authService.transformUserRecordToSchema(dbUser);
    const role = dbUser.is_project_admin ? 'project_admin' : 'authenticated';

    // Generate new access token
    const newAccessToken = tokenManager.generateAccessToken({
      sub: user.id,
      email: user.email,
      role,
    });

    // Generate new refresh token (token rotation for security)
    const newRefreshToken = tokenManager.generateRefreshToken(user.id);

    if (clientType === 'web') {
      // Web clients: set cookie + return CSRF token
      setRefreshTokenCookie(res, newRefreshToken);
      const newCsrfToken = tokenManager.generateCsrfToken(newRefreshToken);

      successResponse(res, {
        accessToken: newAccessToken,
        user,
        csrfToken: newCsrfToken,
      });
    } else {
      // Non-web clients (mobile, desktop, server): return refresh token in body.
      // Server callers are expected to persist the rotated token between requests.
      successResponse(res, {
        accessToken: newAccessToken,
        user,
        refreshToken: newRefreshToken,
      });
    }
  } catch (error) {
    // Clear invalid cookie on error (only for web clients)
    if (clientType === 'web') {
      clearRefreshTokenCookie(res);
    }
    next(error);
  }
});

// POST /api/auth/logout - Logout and clear refresh token cookie
// Query params: client_type (optional) - 'web' (default), 'mobile', 'desktop', or 'server'
// Web clients: clears the httpOnly refresh token cookie
// Non-web clients (mobile, desktop, server): no server-side action needed (client should discard token)
router.post('/logout', (req: Request, res: Response, next: NextFunction) => {
  try {
    const clientType = parseClientType(req.query.client_type);

    if (clientType === 'web') {
      clearRefreshTokenCookie(res);
    }
    // For non-web clients: no server-side cleanup needed.
    // The caller is responsible for discarding the refresh token it stored.

    successResponse(res, {
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/admin/sessions/exchange - Exchange authorization code for admin session
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

    // Set refresh token as httpOnly cookie + CSRF token for web clients
    const tokenManager = TokenManager.getInstance();
    const refreshToken = tokenManager.generateRefreshToken(result.user.id);
    setRefreshTokenCookie(res, refreshToken);
    const csrfToken = tokenManager.generateCsrfToken(refreshToken);

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

    // Set refresh token as httpOnly cookie + CSRF token for web clients
    const tokenManager = TokenManager.getInstance();
    const refreshToken = tokenManager.generateRefreshToken(result.user.id);
    setRefreshTokenCookie(res, refreshToken);
    const csrfToken = tokenManager.generateCsrfToken(refreshToken);

    successResponse(res, { ...result, csrfToken });
  } catch (error) {
    next(error);
  }
});

// GET /api/auth/sessions/current - Get current session user
router.get(
  '/sessions/current',
  verifyToken,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError('User not authenticated', 401, ERROR_CODES.AUTH_INVALID_CREDENTIALS);
      }

      const user = await authService.getUserSchemaById(req.user.id);
      if (!user) {
        throw new AppError('User not found', 401, ERROR_CODES.AUTH_INVALID_CREDENTIALS);
      }

      const response: GetCurrentSessionResponse = {
        user,
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

    const parsedLimit = Math.max(1, parseInt(limit as string) || 10);
    const parsedOffset = Math.max(0, parseInt(offset as string) || 0);

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

// GET /api/auth/users/:userId - Get specific user (admin only)
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
        throw new AppError('User does not exist', 404, ERROR_CODES.NOT_FOUND);
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

      const { email, redirectTo } = validationResult.data;

      // Get auth config to determine verification method
      const authConfig = await authConfigService.getAuthConfig();
      const method = authConfig.verifyEmailMethod;

      // Note: User enumeration is prevented at service layer
      // Service returns gracefully (no error) if user not found
      if (method === 'link') {
        if (!redirectTo) {
          throw new AppError(
            'redirectTo is required when link-based email verification is enabled',
            400,
            ERROR_CODES.INVALID_INPUT
          );
        }

        if (!(await authConfigService.validateRedirectUrl(redirectTo))) {
          logger.warn('Redirect URL is not in allowed redirect URLs for verification email', {
            redirectTo,
          });
          throw new AppError(
            `${redirectTo} is not in the allowed redirect URLs`,
            400,
            ERROR_CODES.INVALID_INPUT,
            'Please add this URL to the allowed redirect URLs in the authentication configuration.'
          );
        }

        await authService.sendVerificationEmailWithLink(email, redirectTo);
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

// POST /api/auth/email/verify - JSON API for email verification code submissions
// This endpoint is only for programmatic clients and manual 6-digit code entry.
// Browser email clicks should use GET /api/auth/email/verify-link above instead.
// Query params: client_type (optional) - 'web' (default), 'mobile', 'desktop', or 'server'
router.post(
  '/email/verify',
  verifyOTPLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const clientType = parseClientType(req.query.client_type);

      const validationResult = verifyEmailRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        throw new AppError(
          validationResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const { email, otp } = validationResult.data;

      const result: VerifyEmailResponse = await authService.verifyEmailWithCode(email, otp);

      // Set refresh token based on client type
      const tokenManager = TokenManager.getInstance();
      const refreshToken = tokenManager.generateRefreshToken(result.user.id);

      if (clientType === 'web') {
        // Web clients: use httpOnly cookie + CSRF token
        setRefreshTokenCookie(res, refreshToken);
        result.csrfToken = tokenManager.generateCsrfToken(refreshToken);
      } else {
        // Non-web clients (mobile, desktop, server): return refresh token in response body.
        // Server clients cannot rely on browser cookies, so they follow the native-app flow.
        result.refreshToken = refreshToken;
      }

      successResponse(res, result);
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

      const { email, redirectTo } = validationResult.data;

      // Get auth config to determine reset password method
      const authConfig = await authConfigService.getAuthConfig();
      const method = authConfig.resetPasswordMethod;

      // Note: User enumeration is prevented at service layer
      // Service returns gracefully (no error) if user not found
      if (method === 'link') {
        if (!redirectTo) {
          throw new AppError(
            'redirectTo is required when link-based password reset is enabled',
            400,
            ERROR_CODES.INVALID_INPUT
          );
        }

        if (!(await authConfigService.validateRedirectUrl(redirectTo))) {
          logger.warn('Redirect URL is not in allowed redirect URLs for password reset email', {
            redirectTo,
          });
          throw new AppError(
            `${redirectTo} is not in the allowed redirect URLs`,
            400,
            ERROR_CODES.INVALID_INPUT,
            'Please add this URL to the allowed redirect URLs in the authentication configuration.'
          );
        }

        await authService.sendResetPasswordEmailWithLink(email, redirectTo);
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

// POST /api/auth/email/reset-password - JSON API to submit a new password
// Token can be:
// - Link token returned to the app via GET /api/auth/email/reset-password-link
// - Reset token from exchange-reset-password-token after code verification
// Both use RESET_PASSWORD purpose and are verified the same way.
// Browser email clicks should use GET /api/auth/email/reset-password-link above instead.
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

      successResponse(res, result);
    } catch (error) {
      next(error);
    }
  }
);

// Resend Configuration Routes
// GET /api/auth/resend-config - Get Resend configuration (admin only)
router.get(
  '/resend-config',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const config = await resendConfigService.getResendConfig();
      successResponse(res, config);
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/auth/resend-config - Update Resend configuration (admin only)
router.put(
  '/resend-config',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const validationResult = upsertResendConfigRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        throw new AppError(
          validationResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const input = validationResult.data;
      const config = await resendConfigService.upsertResendConfig(input);

      await auditService.log({
        actor: req.user?.email || 'api-key',
        action: 'UPDATE_RESEND_CONFIG',
        module: 'EMAIL',
        details: {
          enabled: input.enabled,
        },
        ip_address: req.ip,
      });

      successResponse(res, config);
    } catch (error) {
      next(error);
    }
  }
);

// SMTP Configuration Routes
// GET /api/auth/smtp-config - Get SMTP configuration (admin only)
router.get(
  '/smtp-config',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const config = await smtpConfigService.getSmtpConfig();
      successResponse(res, config);
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/auth/smtp-config - Update SMTP configuration (admin only)
router.put(
  '/smtp-config',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const validationResult = upsertSmtpConfigRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        throw new AppError(
          validationResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const input = validationResult.data;
      const config = await smtpConfigService.upsertSmtpConfig(input);

      await auditService.log({
        actor: req.user?.email || 'api-key',
        action: 'UPDATE_SMTP_CONFIG',
        module: 'EMAIL',
        details: {
          enabled: input.enabled,
          host: input.host,
        },
        ip_address: req.ip,
      });

      successResponse(res, config);
    } catch (error) {
      next(error);
    }
  }
);

// Email Template Routes
// GET /api/auth/email-templates - Get all email templates (admin only)
router.get(
  '/email-templates',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const templates = await emailTemplateService.getTemplates();
      successResponse(res, { data: templates });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/auth/email-templates/:type - Update email template (admin only)
router.put(
  '/email-templates/:type',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!EMAIL_TEMPLATE_TYPES.includes(req.params.type as EmailTemplate)) {
        throw new AppError(
          `Invalid template type. Must be one of: ${EMAIL_TEMPLATE_TYPES.join(', ')}`,
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const validationResult = updateEmailTemplateRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        throw new AppError(
          validationResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const templateType = req.params.type as EmailTemplate;
      const template = await emailTemplateService.updateTemplate(
        templateType,
        validationResult.data
      );

      await auditService.log({
        actor: req.user?.email || 'api-key',
        action: 'UPDATE_EMAIL_TEMPLATE',
        module: 'EMAIL',
        details: {
          templateType,
        },
        ip_address: req.ip,
      });

      successResponse(res, template);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
