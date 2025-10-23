import { Router, Request, Response, NextFunction } from 'express';
import { AuthService } from '@/core/auth/auth.js';
import { AuditService } from '@/core/logs/audit.js';
import { AppError } from '@/api/middleware/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { successResponse } from '@/utils/response.js';
import { AuthRequest, verifyAdmin } from '@/api/middleware/auth.js';
import oauthRouter from './auth.oauth.js';
import {
  userIdSchema,
  createUserRequestSchema,
  createSessionRequestSchema,
  createAdminSessionRequestSchema,
  deleteUsersRequestSchema,
  listUsersRequestSchema,
  requestEmailVerificationSchema,
  requestOneTimePasswordSchema,
  verifyEmailRequestSchema,
  verifyOneTimePasswordRequestSchema,
  type CreateUserResponse,
  type CreateSessionResponse,
  type CreateAdminSessionResponse,
  type GetCurrentSessionResponse,
  type ListUsersResponse,
  type DeleteUsersResponse,
  exchangeAdminSessionRequestSchema,
} from '@insforge/shared-schemas';
import { UserRecord } from '@/types/auth.js';

const router = Router();
const authService = AuthService.getInstance();
const auditService = AuditService.getInstance();

// Mount OAuth routes
router.use('/oauth', oauthRouter);

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

// POST /api/auth/request-email-verification - Request email verification
router.post(
  '/request-email-verification',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validationResult = requestEmailVerificationSchema.safeParse(req.body);
      if (!validationResult.success) {
        throw new AppError(
          validationResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const { email } = validationResult.data;
      await authService.requestEmailVerification(email);
      successResponse(res, { message: 'Email verification sent if the email is registered' });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/auth/request-one-time-password - Request one-time password (OTP)
router.post(
  '/request-one-time-password',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validationResult = requestOneTimePasswordSchema.safeParse(req.body);
      if (!validationResult.success) {
        throw new AppError(
          validationResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }
      const { email } = validationResult.data;
      await authService.requestOneTimePassword(email);
      successResponse(res, { message: 'One-time password sent if the email is registered' });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/auth/verify-email - Verify email with code
router.post('/verify-email', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validationResult = verifyEmailRequestSchema.safeParse(req.body);
    if (!validationResult.success) {
      throw new AppError(
        validationResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }
    const { email, verificationCode } = validationResult.data;
    const result: CreateSessionResponse = await authService.verifyEmail(email, verificationCode);
    successResponse(res, result); // Return session info upon successful verification
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/verify-one-time-password - Verify one-time password (OTP)
router.post(
  '/verify-one-time-password',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validationResult = verifyOneTimePasswordRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        throw new AppError(
          validationResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }
      const { email, otp } = validationResult.data;
      const result: CreateSessionResponse = await authService.verifyOneTimePassword(email, otp);
      successResponse(res, result);
    } catch (error) {
      next(error);
    }
  }
);

// router.post('/auth/request-password-reset', async (req: Request, res: Response, next: NextFunction) => {
//   try {
//     const { email } = req.body;
//     await authService.requestPasswordReset(email);
//     successResponse(res, { message: 'Password reset email sent if the email is registered' });
//   } catch (error) {
//     next(error);
//   }
// });

// router.post('/auth/reset-password', async (req: Request, res: Response, next: NextFunction) => {
//   try {
//     const { token, newPassword } = req.body;
//     await authService.resetPassword(token, newPassword);
//     successResponse(res, { message: 'Password has been reset successfully' });
//   } catch (error) {
//     next(error);
//   }
// });

export default router;
