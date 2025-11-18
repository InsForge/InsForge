import { Router, Request, Response, NextFunction } from 'express';
import { AuthService } from '@/services/auth/auth.service.js';
import { AuthConfigService } from '@/services/auth/auth-config.service.js';
import { OAuthConfigService } from '@/services/auth/oauth-config.service.js';
import { AuditService } from '@/services/logs/audit.service.js';
import { AppError } from '@/api/middleware/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { successResponse } from '@/utils/response.js';
import { AuthRequest, verifyAdmin } from '@/api/middleware/auth.js';
import oauthRouter from './auth.oauth.js';
import { sendEmailOTPLimiter, verifyOTPLimiter } from '@/api/middleware/rate-limiters.js';
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
import { UserRecord } from '@/types/auth.js';
import { SocketService } from '@/infra/socket/socket.js';
import { DataUpdateResourceType, ServerEvents } from '@/types/socket.js';

const router = Router();
const authService = AuthService.getInstance();
const authConfigService = AuthConfigService.getInstance();
const oAuthConfigService = OAuthConfigService.getInstance();
const auditService = AuditService.getInstance();

// Mount OAuth routes
router.use('/oauth', oauthRouter);

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

    res.json(response);
  } catch (error) {
    next(error);
  }
});

// Email Authentication Configuration Routes
// GET /api/auth/config - Get authentication configurations (admin only)
router.get('/config', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const config: GetAuthConfigResponse = await authConfigService.getAuthConfig();
    res.json(config);
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
    const result: CreateUserResponse = await authService.register(email, password, name);

    const socket = SocketService.getInstance();
    socket.broadcastToRoom('role:project_admin', ServerEvents.DATA_UPDATE, {
      resource: DataUpdateResourceType.USERS,
    });

    successResponse(res, result);
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/sessions - Create a new session (login)
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
    const result: CreateSessionResponse = await authService.login(email, password);

    successResponse(res, result);
  } catch (error) {
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
router.get('/sessions/current', (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError('No token provided', 401, ERROR_CODES.AUTH_INVALID_CREDENTIALS);
    }

    const token = authHeader.substring(7);
    const payload = authService.verifyToken(token);

    const response: GetCurrentSessionResponse = {
      user: {
        id: payload.sub,
        email: payload.email,
        role: payload.role,
      },
    };

    res.json(response);
  } catch {
    next(new AppError('Invalid token', 401, ERROR_CODES.AUTH_INVALID_CREDENTIALS));
  }
});

// GET /api/auth/users - List all users (admin only)
router.get('/users', verifyAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const queryValidation = listUsersRequestSchema.safeParse(req.query);
    const queryParams = queryValidation.success ? queryValidation.data : req.query;
    const { limit = '10', offset = '0', search } = queryParams || {};
    const db = authService.getDb();

    let query = `
      SELECT 
        u.id, 
        u.email, 
        u.name, 
        u.email_verified, 
        u.created_at, 
        u.updated_at,
        u.password,
        STRING_AGG(a.provider, ',') as providers
      FROM _accounts u
      LEFT JOIN _account_providers a ON u.id = a.user_id
    `;
    const params: (string | number)[] = [];

    if (search) {
      query += ' WHERE u.email LIKE ? OR u.name LIKE ?';
      params.push(`%${search}%`, `%${search}%`);
    }

    query += ' GROUP BY u.id ORDER BY u.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit as string), parseInt(offset as string));

    const dbUsers = await db.prepare(query).all(...params);

    // Simple transformation - just format the provider as identities
    const users = dbUsers.map((dbUser: UserRecord) => {
      const identities = [];
      const providers: string[] = [];

      // Add social providers if any
      if (dbUser.providers) {
        dbUser.providers.split(',').forEach((provider: string) => {
          identities.push({ provider });
          providers.push(provider);
        });
      }

      // Add email provider if password exists
      if (dbUser.password) {
        identities.push({ provider: 'email' });
        providers.push('email');
      }

      // Use first provider to determine type: 'email' or 'social'
      const firstProvider = providers[0];
      const provider_type = firstProvider === 'email' ? 'email' : 'social';

      // Return for frontend compatibility
      return {
        id: dbUser.id,
        email: dbUser.email,
        name: dbUser.name,
        emailVerified: dbUser.email_verified,
        createdAt: dbUser.created_at,
        updatedAt: dbUser.updated_at,
        identities: identities,
        providerType: provider_type,
      };
    });

    let countQuery = 'SELECT COUNT(*) as count FROM _accounts';
    const countParams: string[] = [];
    if (search) {
      countQuery += ' WHERE email LIKE ? OR name LIKE ?';
      countParams.push(`%${search}%`, `%${search}%`);
    }
    const { count } = (await db.prepare(countQuery).get(...countParams)) as { count: number };

    const response: ListUsersResponse = {
      data: users,
      pagination: {
        offset: parseInt(offset as string),
        limit: parseInt(limit as string),
        total: count,
      },
    };

    res.json(response);
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
      const db = authService.getDb();

      const dbUser = (await db
        .prepare(
          `
      SELECT
        u.id,
        u.email,
        u.name,
        u.email_verified,
        u.created_at,
        u.updated_at,
        u.password,
        STRING_AGG(a.provider, ',') as providers
      FROM _accounts u
      LEFT JOIN _account_providers a ON u.id = a.user_id
      WHERE u.id = ?
      GROUP BY u.id
    `
        )
        .get(userId)) as UserRecord | undefined;

      if (!dbUser) {
        throw new AppError('User not found', 404, ERROR_CODES.NOT_FOUND);
      }

      // Simple transformation - just format the provider as identities
      const identities = [];
      const providers: string[] = [];

      // Add social providers if any
      if (dbUser.providers) {
        dbUser.providers.split(',').forEach((provider: string) => {
          identities.push({ provider });
          providers.push(provider);
        });
      }

      // Add email provider if password exists
      if (dbUser.password) {
        identities.push({ provider: 'Email' });
        providers.push('email');
      }

      // Use first provider to determine type: 'email' or 'social'
      const firstProvider = providers[0];
      const provider_type = firstProvider === 'email' ? 'Email' : 'Social';

      // Return snake_case for frontend compatibility
      const user = {
        id: dbUser.id,
        email: dbUser.email,
        name: dbUser.name,
        email_verified: dbUser.email_verified,
        created_at: dbUser.created_at,
        updated_at: dbUser.updated_at,
        identities: identities,
        provider_type: provider_type,
      };

      res.json(user);
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

      const db = authService.getDb();
      const placeholders = userIds.map(() => '?').join(',');

      await db.prepare(`DELETE FROM _accounts WHERE id IN (${placeholders})`).run(...userIds);

      // Log audit for user deletion
      await auditService.log({
        actor: req.user?.email || 'api-key',
        action: 'DELETE_USERS',
        module: 'AUTH',
        details: {
          userIds,
          deletedCount: userIds.length,
        },
        ip_address: req.ip,
      });

      const response: DeleteUsersResponse = {
        message: 'Users deleted successfully',
        deletedCount: userIds.length,
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/auth/tokens/anon - Generate anonymous JWT token (never expires)
router.post('/tokens/anon', verifyAdmin, (_req: Request, res: Response, next: NextFunction) => {
  try {
    const token = authService.generateAnonToken();

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

      res.status(202).json({
        success: true,
        message,
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/auth/email/verify - Verify email with OTP
// Uses verifyEmailMethod from auth config to determine verification type:
// - 'code': expects email + 6-digit numeric code
// - 'link': expects 64-char hex token only
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

      // Get auth config to determine verification method
      const authConfig = await authConfigService.getAuthConfig();
      const method = authConfig.verifyEmailMethod;

      let result: VerifyEmailResponse;

      if (method === 'link') {
        // Link verification: otp is 64-char hex token
        result = await authService.verifyEmailWithToken(otp);
      } else {
        // Code verification: requires email + 6-digit code
        if (!email) {
          throw new AppError(
            'Email is required for code verification',
            400,
            ERROR_CODES.INVALID_INPUT
          );
        }
        result = await authService.verifyEmailWithCode(email, otp);
      }

      successResponse(res, result); // Return session info with optional redirectTo upon successful verification
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

      res.status(202).json({
        success: true,
        message,
      });
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
