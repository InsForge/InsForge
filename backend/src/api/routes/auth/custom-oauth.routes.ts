import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { successResponse } from '@/utils/response.js';
import { AuthRequest, verifyAdmin } from '@/api/middlewares/auth.js';
import logger from '@/utils/logger.js';
import { AuthService } from '@/services/auth/auth.service.js';
import { OAuthPKCEService } from '@/services/auth/oauth-pkce.service.js';
import { AuthConfigService } from '@/services/auth/auth-config.service.js';
import { CustomOAuthConfigService } from '@/services/auth/custom-oauth-config.service.js';
import { AuditService } from '@/services/logs/audit.service.js';
import { CustomOAuthProvider } from '@/providers/oauth/custom.provider.js';
import {
  createCustomOAuthConfigRequestSchema,
  updateCustomOAuthConfigRequestSchema,
  listCustomOAuthConfigsResponseSchema,
  oAuthInitRequestSchema,
  customOAuthKeySchema,
} from '@insforge/shared-schemas';

const router = Router();
const authService = AuthService.getInstance();
const authConfigService = AuthConfigService.getInstance();
const oAuthPKCEService = OAuthPKCEService.getInstance();
const customOAuthConfigService = CustomOAuthConfigService.getInstance();
const customOAuthProvider = CustomOAuthProvider.getInstance();
const auditService = AuditService.getInstance();

const validateJwtSecret = (): string => {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || jwtSecret.trim() === '') {
    throw new AppError(
      'JWT_SECRET environment variable is not configured.',
      500,
      ERROR_CODES.INTERNAL_ERROR
    );
  }
  return jwtSecret;
};

// ── Admin CRUD ──────────────────────────────────────────────────────────

router.get('/configs', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const configs = await customOAuthConfigService.listConfigs();
    const payload = { data: configs, count: configs.length };
    const parsed = listCustomOAuthConfigsResponseSchema.parse(payload);
    successResponse(res, parsed);
  } catch (error) {
    logger.error('Failed to list custom OAuth configs', { error });
    next(error);
  }
});

router.get(
  '/:key/config',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const keyValidation = customOAuthKeySchema.safeParse(req.params.key);
      if (!keyValidation.success) {
        throw new AppError('Invalid custom OAuth key', 400, ERROR_CODES.INVALID_INPUT);
      }
      const key = keyValidation.data;

      const config = await customOAuthConfigService.getConfigByKey(key);
      if (!config) {
        throw new AppError(
          `Custom OAuth configuration for ${key} not found`,
          404,
          ERROR_CODES.NOT_FOUND
        );
      }
      const clientSecret = await customOAuthConfigService.getClientSecretByKey(key);
      successResponse(res, {
        ...config,
        clientSecret: clientSecret || undefined,
      });
    } catch (error) {
      logger.error('Failed to get custom OAuth config', { error, key: req.params.key });
      next(error);
    }
  }
);

router.post(
  '/configs',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const validationResult = createCustomOAuthConfigRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        throw new AppError(
          validationResult.error.issues
            .map(
              (e: { path: (string | number)[]; message: string }) =>
                `${e.path.join('.')}: ${e.message}`
            )
            .join(', '),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const config = await customOAuthConfigService.createConfig(validationResult.data);
      await auditService.log({
        actor: req.user?.email || 'api-key',
        action: 'CREATE_CUSTOM_OAUTH_CONFIG',
        module: 'AUTH',
        details: {
          key: config.key,
          name: config.name,
        },
        ip_address: req.ip,
      });
      successResponse(res, config);
    } catch (error) {
      logger.error('Failed to create custom OAuth config', { error });
      next(error);
    }
  }
);

router.put(
  '/:key/config',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const keyValidation = customOAuthKeySchema.safeParse(req.params.key);
      if (!keyValidation.success) {
        throw new AppError('Invalid custom OAuth key', 400, ERROR_CODES.INVALID_INPUT);
      }
      const key = keyValidation.data;

      const validationResult = updateCustomOAuthConfigRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        throw new AppError(
          validationResult.error.issues
            .map(
              (e: { path: (string | number)[]; message: string }) =>
                `${e.path.join('.')}: ${e.message}`
            )
            .join(', '),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const config = await customOAuthConfigService.updateConfig(key, validationResult.data);
      await auditService.log({
        actor: req.user?.email || 'api-key',
        action: 'UPDATE_CUSTOM_OAUTH_CONFIG',
        module: 'AUTH',
        details: {
          key,
          updatedFields: Object.keys(validationResult.data),
        },
        ip_address: req.ip,
      });
      successResponse(res, config);
    } catch (error) {
      logger.error('Failed to update custom OAuth config', { error, key: req.params.key });
      next(error);
    }
  }
);

router.delete(
  '/:key/config',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const keyValidation = customOAuthKeySchema.safeParse(req.params.key);
      if (!keyValidation.success) {
        throw new AppError('Invalid custom OAuth key', 400, ERROR_CODES.INVALID_INPUT);
      }
      const deleted = await customOAuthConfigService.deleteConfig(keyValidation.data);
      if (!deleted) {
        throw new AppError(
          `Custom OAuth configuration for ${req.params.key} not found`,
          404,
          ERROR_CODES.NOT_FOUND
        );
      }
      await auditService.log({
        actor: req.user?.email || 'api-key',
        action: 'DELETE_CUSTOM_OAUTH_CONFIG',
        module: 'AUTH',
        details: {
          key: keyValidation.data,
        },
        ip_address: req.ip,
      });
      successResponse(res, {
        success: true,
        message: `Custom OAuth configuration for ${req.params.key} deleted successfully`,
      });
    } catch (error) {
      logger.error('Failed to delete custom OAuth config', { error, key: req.params.key });
      next(error);
    }
  }
);

// ── Public OAuth flow (init + callback) ─────────────────────────────────

router.get('/:key', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const keyValidation = customOAuthKeySchema.safeParse(req.params.key);
    if (!keyValidation.success) {
      throw new AppError('Invalid custom OAuth key', 400, ERROR_CODES.INVALID_INPUT);
    }
    const key = keyValidation.data;

    const queryValidation = oAuthInitRequestSchema.safeParse(req.query);
    if (!queryValidation.success) {
      throw new AppError(
        queryValidation.error.issues
          .map(
            (e: { path: (string | number)[]; message: string }) =>
              `${e.path.join('.')}: ${e.message}`
          )
          .join(', '),
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const { redirect_uri, code_challenge } = queryValidation.data;
    const authConfig = await authConfigService.getAuthConfig();
    const redirectUri = authConfig.signInRedirectTo || redirect_uri;
    if (!redirectUri) {
      throw new AppError('Redirect URI is required', 400, ERROR_CODES.INVALID_INPUT);
    }

    const state = jwt.sign(
      {
        provider: key,
        redirectUri,
        codeChallenge: code_challenge,
        createdAt: Date.now(),
      },
      validateJwtSecret(),
      { algorithm: 'HS256', expiresIn: '1h' }
    );

    const authUrl = await customOAuthProvider.generateOAuthUrl(key, state);
    successResponse(res, { authUrl });
  } catch (error) {
    logger.error('Custom OAuth init failed', { error, key: req.params.key });
    next(error);
  }
});

router.get('/:key/callback', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const keyValidation = customOAuthKeySchema.safeParse(req.params.key);
    if (!keyValidation.success) {
      throw new AppError('Invalid custom OAuth key', 400, ERROR_CODES.INVALID_INPUT);
    }
    const key = keyValidation.data;
    const code = req.query.code as string | undefined;
    const state = req.query.state as string | undefined;
    if (!code || !state) {
      throw new AppError('code and state are required', 400, ERROR_CODES.INVALID_INPUT);
    }

    const stateData = jwt.verify(state, validateJwtSecret()) as {
      provider: string;
      redirectUri: string;
      codeChallenge: string;
    };
    if (stateData.provider !== key) {
      throw new AppError(
        'Provider mismatch between callback path and state',
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }
    if (!stateData.redirectUri) {
      throw new AppError('redirectUri is required in state', 400, ERROR_CODES.INVALID_INPUT);
    }
    if (!stateData.codeChallenge) {
      throw new AppError('code_challenge is required in state', 400, ERROR_CODES.INVALID_INPUT);
    }

    const oauthUser = await customOAuthProvider.handleCallback(key, code, state);
    const session = await authService.findOrCreateThirdPartyUser(
      oauthUser.provider,
      oauthUser.providerId,
      oauthUser.email,
      oauthUser.userName,
      oauthUser.avatarUrl,
      oauthUser.identityData
    );

    const exchangeCode = oAuthPKCEService.createCode({
      userId: session.user.id,
      codeChallenge: stateData.codeChallenge,
      provider: key,
    });

    const successUrl = new URL(stateData.redirectUri);
    successUrl.searchParams.set('insforge_code', exchangeCode);
    return res.redirect(successUrl.toString());
  } catch (error) {
    logger.error('Custom OAuth callback failed', {
      key: req.params.key,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
    });
    if (req.query.state) {
      try {
        const stateData = jwt.verify(req.query.state as string, validateJwtSecret()) as {
          redirectUri?: string;
        };
        if (stateData.redirectUri) {
          const errorUrl = new URL(stateData.redirectUri);
          errorUrl.searchParams.set('error', 'Authentication failed');
          return res.redirect(errorUrl.toString());
        }
      } catch {
        // Ignore redirect fallback failures
      }
    }
    next(error);
  }
});

export default router;
