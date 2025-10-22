import { Router, Request, Response, NextFunction } from 'express';
import { AuthService } from '@/core/auth/auth.js';
import { OAuthConfigService } from '@/core/auth/oauth.js';
import { AuditService } from '@/core/logs/audit.js';
import { AppError } from '@/api/middleware/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { successResponse } from '@/utils/response.js';
import { AuthRequest, verifyAdmin } from '@/api/middleware/auth.js';
import logger from '@/utils/logger.js';
import jwt from 'jsonwebtoken';
import { SocketService } from '@/core/socket/socket.js';
import { DataUpdateResourceType, ServerEvents } from '@/core/socket/types.js';
import {
  createOAuthConfigRequestSchema,
  updateOAuthConfigRequestSchema,
  type ListOAuthConfigsResponse,
  oAuthProvidersSchema,
} from '@insforge/shared-schemas';
import { isOAuthSharedKeysAvailable } from '@/utils/environment.js';

const router = Router();
const authService = AuthService.getInstance();
const oauthConfigService = OAuthConfigService.getInstance();
const auditService = AuditService.getInstance();

// Helper function to validate JWT_SECRET
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

// OAuth Configuration Management Routes (must come before wildcard routes)
// GET /api/auth/oauth/configs - List all OAuth configurations (admin only)
router.get('/configs', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const configs = await oauthConfigService.getAllConfigs();
    const response: ListOAuthConfigsResponse = {
      data: configs,
      count: configs.length,
    };
    res.json(response);
  } catch (error) {
    logger.error('Failed to list OAuth configurations', { error });
    next(error);
  }
});

// GET /api/auth/oauth/configs/:provider - Get specific OAuth configuration (admin only)
router.get(
  '/configs/:provider',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { provider } = req.params;
      const config = await oauthConfigService.getConfigByProvider(provider);
      const clientSecret = await oauthConfigService.getClientSecretByProvider(provider);

      if (!config) {
        throw new AppError(
          `OAuth configuration for ${provider} not found`,
          404,
          ERROR_CODES.NOT_FOUND
        );
      }

      res.json({
        ...config,
        clientSecret: clientSecret || undefined,
      });
    } catch (error) {
      logger.error('Failed to get OAuth config by provider', {
        provider: req.params.provider,
        error,
      });
      next(error);
    }
  }
);

// POST /api/auth/oauth/configs - Create new OAuth configuration (admin only)
router.post(
  '/configs',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const validationResult = createOAuthConfigRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        throw new AppError(
          validationResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const input = validationResult.data;

      // Check if using shared keys when not allowed
      if (input.useSharedKey && !isOAuthSharedKeysAvailable()) {
        throw new AppError(
          'Shared OAuth keys are not enabled in this environment',
          400,
          ERROR_CODES.AUTH_OAUTH_CONFIG_ERROR
        );
      }

      const config = await oauthConfigService.createConfig(input);

      await auditService.log({
        actor: req.user?.email || 'api-key',
        action: 'CREATE_OAUTH_CONFIG',
        module: 'AUTH',
        details: {
          provider: input.provider,
          useSharedKey: input.useSharedKey || false,
        },
        ip_address: req.ip,
      });

      // Broadcast configuration change
      const socket = SocketService.getInstance();
      socket.broadcastToRoom('role:project_admin', ServerEvents.DATA_UPDATE, {
        resource: DataUpdateResourceType.AUTH_SCHEMA,
      });

      successResponse(res, config);
    } catch (error) {
      logger.error('Failed to create OAuth configuration', { error });
      next(error);
    }
  }
);

// PUT /api/auth/oauth/configs/:provider - Update OAuth configuration (admin only)
router.put(
  '/configs/:provider',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const provider = req.params.provider;
      if (!provider || provider.length === 0 || provider.length > 50) {
        throw new AppError('Invalid provider name', 400, ERROR_CODES.INVALID_INPUT);
      }

      const validationResult = updateOAuthConfigRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        throw new AppError(
          validationResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const input = validationResult.data;

      // Check if using shared keys when not allowed
      if (input.useSharedKey && !isOAuthSharedKeysAvailable()) {
        throw new AppError(
          'Shared OAuth keys are not enabled in this environment',
          400,
          ERROR_CODES.AUTH_OAUTH_CONFIG_ERROR
        );
      }

      const config = await oauthConfigService.updateConfig(provider, input);

      await auditService.log({
        actor: req.user?.email || 'api-key',
        action: 'UPDATE_OAUTH_CONFIG',
        module: 'AUTH',
        details: {
          provider,
          updatedFields: Object.keys(input),
        },
        ip_address: req.ip,
      });

      // Broadcast configuration change
      const socket = SocketService.getInstance();
      socket.broadcastToRoom('role:project_admin', ServerEvents.DATA_UPDATE, {
        resource: DataUpdateResourceType.AUTH_SCHEMA,
      });

      successResponse(res, config);
    } catch (error) {
      logger.error('Failed to update OAuth configuration', {
        error,
        provider: req.params.provider,
      });
      next(error);
    }
  }
);

// DELETE /api/auth/oauth/configs/:provider - Delete OAuth configuration (admin only)
router.delete(
  '/configs/:provider',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const provider = req.params.provider;
      if (!provider || provider.length === 0 || provider.length > 50) {
        throw new AppError('Invalid provider name', 400, ERROR_CODES.INVALID_INPUT);
      }
      const deleted = await oauthConfigService.deleteConfig(provider);

      if (!deleted) {
        throw new AppError(
          `OAuth configuration for ${provider} not found`,
          404,
          ERROR_CODES.NOT_FOUND
        );
      }

      await auditService.log({
        actor: req.user?.email || 'api-key',
        action: 'DELETE_OAUTH_CONFIG',
        module: 'AUTH',
        details: { provider },
        ip_address: req.ip,
      });

      // Broadcast configuration change
      const socket = SocketService.getInstance();
      socket.broadcastToRoom('role:project_admin', ServerEvents.DATA_UPDATE, {
        resource: DataUpdateResourceType.AUTH_SCHEMA,
      });

      successResponse(res, {
        success: true,
        message: `OAuth configuration for ${provider} deleted successfully`,
      });
    } catch (error) {
      logger.error('Failed to delete OAuth configuration', {
        error,
        provider: req.params.provider,
      });
      next(error);
    }
  }
);

// OAuth Flow Routes
// GET /api/auth/oauth/:provider - Initialize OAuth flow for any supported provider
router.get('/:provider', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { provider } = req.params;
    const { redirect_uri } = req.query;

    // Validate provider using OAuthProvidersSchema
    const providerValidation = oAuthProvidersSchema.safeParse(provider);
    if (!providerValidation.success) {
      throw new AppError(
        `Unsupported OAuth provider: ${provider}. Supported providers: ${oAuthProvidersSchema.options.join(', ')}`,
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const validatedProvider = providerValidation.data;

    if (!redirect_uri) {
      throw new AppError('Redirect URI is required', 400, ERROR_CODES.INVALID_INPUT);
    }

    const jwtPayload = {
      provider: validatedProvider,
      redirectUri: redirect_uri ? (redirect_uri as string) : undefined,
      createdAt: Date.now(),
    };
    const jwtSecret = validateJwtSecret();
    const state = jwt.sign(jwtPayload, jwtSecret, {
      algorithm: 'HS256',
      expiresIn: '1h', // Set expiration time for the state token
    });

    const authUrl = await authService.generateOAuthUrl(validatedProvider, state);

    res.json({ authUrl });
  } catch (error) {
    logger.error(`${req.params.provider} OAuth error`, { error });

    // If it's already an AppError, pass it through
    if (error instanceof AppError) {
      next(error);
      return;
    }

    // For other errors, return the generic OAuth configuration error
    next(
      new AppError(
        `${req.params.provider} OAuth is not properly configured. Please check your oauth configurations.`,
        500,
        ERROR_CODES.AUTH_OAUTH_CONFIG_ERROR
      )
    );
  }
});

// GET /api/auth/oauth/shared/callback/:state - Shared callback for OAuth providers
router.get('/shared/callback/:state', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { state } = req.params;
    const { success, error, payload } = req.query;

    if (!state) {
      logger.warn('Shared OAuth callback called without state parameter');
      throw new AppError('State parameter is required', 400, ERROR_CODES.INVALID_INPUT);
    }

    let redirectUri: string;
    let provider: string;
    try {
      const jwtSecret = validateJwtSecret();
      const decodedState = jwt.verify(state, jwtSecret) as {
        provider: string;
        redirectUri: string;
      };
      redirectUri = decodedState.redirectUri || '';
      provider = decodedState.provider || '';
    } catch {
      logger.warn('Invalid state parameter', { state });
      throw new AppError('Invalid state parameter', 400, ERROR_CODES.INVALID_INPUT);
    }

    // Validate provider using OAuthProvidersSchema
    const providerValidation = oAuthProvidersSchema.safeParse(provider);
    if (!providerValidation.success) {
      logger.warn('Invalid provider in state', { provider });
      throw new AppError(
        `Invalid provider in state: ${provider}. Supported providers: ${oAuthProvidersSchema.options.join(', ')}`,
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }
    const validatedProvider = providerValidation.data;
    if (!redirectUri) {
      throw new AppError('Origin is required', 400, ERROR_CODES.INVALID_INPUT);
    }

    if (success !== 'true') {
      const errorMessage = error || 'OAuth authentication failed';
      logger.warn('Shared OAuth callback failed', { error: errorMessage, provider });
      return res.redirect(`${redirectUri}/?error=${encodeURIComponent(String(errorMessage))}`);
    }

    if (!payload) {
      throw new AppError('No payload provided in callback', 400, ERROR_CODES.INVALID_INPUT);
    }

    try {
      const payloadData = JSON.parse(Buffer.from(payload as string, 'base64').toString('utf8'));
      const result = await authService.handleOAuthCallback(validatedProvider, payloadData);

      const finalredirectUri = new URL(redirectUri);
      finalredirectUri.searchParams.set('access_token', result?.accessToken ?? '');
      finalredirectUri.searchParams.set('user_id', result?.user.id ?? '');
      finalredirectUri.searchParams.set('email', result?.user.email ?? '');
      finalredirectUri.searchParams.set('name', result?.user.name ?? '');
      res.redirect(finalredirectUri.toString());
    } catch (error) {
      logger.error('OAuth callback processing failed', { error, provider });
      res.redirect(`${redirectUri}/?error=${encodeURIComponent('Authentication failed')}`);
    }
  } catch (error) {
    logger.error('Shared OAuth callback error', { error });
    next(error);
  }
});

// GET /api/auth/oauth/:provider/callback - OAuth provider callback
router.get('/:provider/callback', async (req: Request, res: Response, _: NextFunction) => {
  try {
    const { provider } = req.params;
    const { code, state, token } = req.query;

    let redirectUri = '/';

    if (state) {
      try {
        const jwtSecret = validateJwtSecret();
        const stateData = jwt.verify(state as string, jwtSecret) as {
          provider: string;
          redirectUri: string;
        };
        redirectUri = stateData.redirectUri || '/';
      } catch {
        // Invalid state, use default redirectUri
        logger.warn('Invalid state in provider callback, using default origin', { state });
      }
    }

    // Validate provider using OAuthProvidersSchema
    const providerValidation = oAuthProvidersSchema.safeParse(provider);
    if (!providerValidation.success) {
      throw new AppError(
        `Unsupported OAuth provider: ${provider}. Supported providers: ${oAuthProvidersSchema.options.join(', ')}`,
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const validatedProvider = providerValidation.data;

    const result = await authService.handleOAuthCallback(validatedProvider, {
      code: code as string | undefined,
      token: token as string | undefined,
    });

    const finalredirectUri = new URL(redirectUri);
    finalredirectUri.searchParams.set('access_token', result?.accessToken ?? '');
    finalredirectUri.searchParams.set('user_id', result?.user.id ?? '');
    finalredirectUri.searchParams.set('email', result?.user.email ?? '');
    finalredirectUri.searchParams.set('name', result?.user.name ?? '');

    logger.info('OAuth callback successful, redirecting with token', {
      redirectUri: finalredirectUri.toString(),
      hasAccessToken: !!result?.accessToken,
      hasUserId: !!result?.user?.id,
      provider: validatedProvider,
    });

    // Redirect to the validated origin without sensitive data in URL
    return res.redirect(finalredirectUri.toString());
  } catch (error) {
    logger.error('OAuth callback error', {
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
      provider: req.params.provider,
      hasCode: !!req.query.code,
      hasState: !!req.query.state,
      hasToken: !!req.query.token,
    });

    // Redirect to app with error message
    const { state } = req.query;
    const redirectUri = state
      ? (() => {
          try {
            const stateData = JSON.parse(Buffer.from(state as string, 'base64').toString());
            return stateData.redirectUri || '/';
          } catch {
            return '/';
          }
        })()
      : '/';

    const errorMessage = error instanceof Error ? error.message : 'OAuth authentication failed';

    // Redirect with error in URL parameters
    const errorredirectUri = new URL(redirectUri);
    errorredirectUri.searchParams.set('error', errorMessage);

    return res.redirect(errorredirectUri.toString());
  }
});

export default router;
