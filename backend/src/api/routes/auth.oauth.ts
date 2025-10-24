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
} from '@insforge/shared-schemas';
import { isOAuthSharedKeysAvailable } from '@/utils/environment.js';

const router = Router();
const authService = AuthService.getInstance();
const oauthConfigService = OAuthConfigService.getInstance();
const auditService = AuditService.getInstance();

// GET /api/auth/oauth/facebook - Initialize Facebook OAuth flow
router.get('/facebook', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { redirect_uri } = req.query;
    if (!redirect_uri) {
      throw new AppError('Redirect URI is required', 400, ERROR_CODES.INVALID_INPUT);
    }

    const jwtPayload = {
      provider: 'facebook',
      redirectUri: redirect_uri ? (redirect_uri as string) : undefined,
      createdAt: Date.now(),
    };
    const state = jwt.sign(jwtPayload, process.env.JWT_SECRET || 'default_secret', {
      algorithm: 'HS256',
      expiresIn: '1h',
    });
    const authUrl = await authService.generateFacebookAuthUrl(state);

    res.json({ authUrl });
  } catch (error) {
    logger.error('Facebook OAuth error', { error });
    next(
      new AppError(
        'Facebook OAuth is not properly configured. Please check your oauth configurations.',
        500,
        ERROR_CODES.AUTH_OAUTH_CONFIG_ERROR
      )
    );
  }
});

// GET /api/auth/oauth/google - Initialize Google OAuth flow
router.get('/google', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { redirect_uri } = req.query;
    if (!redirect_uri) {
      throw new AppError('Redirect URI is required', 400, ERROR_CODES.INVALID_INPUT);
    }

    const jwtPayload = {
      provider: 'google',
      redirectUri: redirect_uri ? (redirect_uri as string) : undefined,
      createdAt: Date.now(),
    };
    const state = jwt.sign(jwtPayload, process.env.JWT_SECRET || 'default_secret', {
      algorithm: 'HS256',
      expiresIn: '1h', // Set expiration time for the state token
    });
    const authUrl = await authService.generateGoogleAuthUrl(state);

    res.json({ authUrl });
  } catch (error) {
    logger.error('Google OAuth error', { error });
    next(
      new AppError(
        'Google OAuth is not properly configured. Please check your oauth configurations.',
        500,
        ERROR_CODES.AUTH_OAUTH_CONFIG_ERROR
      )
    );
  }
});

// GET /api/auth/oauth/github - Initialize GitHub OAuth flow
router.get('/github', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { redirect_uri } = req.query;
    if (!redirect_uri) {
      throw new AppError('Redirect URI is required', 400, ERROR_CODES.INVALID_INPUT);
    }

    const jwtPayload = {
      provider: 'github',
      redirectUri: redirect_uri ? (redirect_uri as string) : undefined,
      createdAt: Date.now(),
    };
    const state = jwt.sign(jwtPayload, process.env.JWT_SECRET || 'default_secret', {
      algorithm: 'HS256',
      expiresIn: '1h', // Set expiration time for the state token
    });

    const authUrl = await authService.generateGitHubAuthUrl(state);

    res.json({ authUrl });
  } catch (error) {
    logger.error('GitHub OAuth error', { error });
    next(
      new AppError(
        'GitHub OAuth is not properly configured. Please check your oauth configurations.',
        500,
        ERROR_CODES.AUTH_OAUTH_CONFIG_ERROR
      )
    );
  }
});

// GET /api/auth/oauth/discord - Initialize Discord OAuth flow
router.get('/discord', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { redirect_uri } = req.query;
    if (!redirect_uri) {
      throw new AppError('Redirect URI is required', 400, ERROR_CODES.INVALID_INPUT);
    }

    const jwtPayload = {
      provider: 'discord',
      redirectUri: redirect_uri ? (redirect_uri as string) : undefined,
      createdAt: Date.now(),
    };
    const state = jwt.sign(jwtPayload, process.env.JWT_SECRET || 'default_secret', {
      algorithm: 'HS256',
      expiresIn: '1h', // Set expiration time for the state token
    });

    const authUrl = await authService.generateDiscordAuthUrl(state);

    res.json({ authUrl });
  } catch (error) {
    logger.error('Discord OAuth error', { error });
    next(
      new AppError(
        'Discord OAuth is not properly configured. Please check your oauth configurations.',
        500,
        ERROR_CODES.AUTH_OAUTH_CONFIG_ERROR
      )
    );
  }
});

// GET /api/auth/oauth/linkedin - Initialize LinkedIn OAuth flow
router.get('/linkedin', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { redirect_uri } = req.query;
    if (!redirect_uri) {
      throw new AppError('Redirect URI is required', 400, ERROR_CODES.INVALID_INPUT);
    }

    const jwtPayload = {
      provider: 'linkedin',
      redirectUri: redirect_uri ? (redirect_uri as string) : undefined,
      createdAt: Date.now(),
    };
    const state = jwt.sign(jwtPayload, process.env.JWT_SECRET || 'default_secret', {
      algorithm: 'HS256',
      expiresIn: '1h',
    });

    const authUrl = await authService.generateLinkedInAuthUrl(state);

    res.json({ authUrl });
  } catch (error) {
    logger.error('LinkedIn OAuth error', { error });
    next(
      new AppError(
        'LinkedIn OAuth is not properly configured. Please check your oauth configurations.',
        500,
        ERROR_CODES.AUTH_OAUTH_CONFIG_ERROR
      )
    );
  }
});

// NEW: GET /api/auth/oauth/microsoft - Initialize Microsoft OAuth flow
router.get('/microsoft', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { redirect_uri } = req.query;
    if (!redirect_uri) {
      throw new AppError('Redirect URI is required', 400, ERROR_CODES.INVALID_INPUT);
    }

    const jwtPayload = {
      provider: 'microsoft',
      redirectUri: redirect_uri ? (redirect_uri as string) : undefined,
      createdAt: Date.now(),
    };
    const state = jwt.sign(jwtPayload, process.env.JWT_SECRET || 'default_secret', {
      algorithm: 'HS256',
      expiresIn: '1h',
    });

    const authUrl = await authService.generateMicrosoftAuthUrl(state);
    res.json({ authUrl });
  } catch (error) {
    logger.error('Microsoft OAuth error', { error });
    next(
      new AppError(
        'Microsoft OAuth is not properly configured. Please check your oauth configurations.',
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
      const decodedState = jwt.verify(state, process.env.JWT_SECRET || 'default_secret') as {
        provider: string;
        redirectUri: string;
      };
      redirectUri = decodedState.redirectUri || '/';
      provider = decodedState.provider || '';
    } catch {
      logger.warn('Invalid state parameter', { state });
      throw new AppError('Invalid state parameter', 400, ERROR_CODES.INVALID_INPUT);
    }

    if (!['google', 'github', 'facebook', 'discord', 'linkedin'].includes(provider)) {
      logger.warn('Invalid provider in state', { provider });
      throw new AppError('Invalid provider in state', 400, ERROR_CODES.INVALID_INPUT);
    }
    if (!redirectUri) {
      throw new AppError('Redirect URL is required', 400, ERROR_CODES.INVALID_INPUT);
    }

    if (success !== 'true') {
      const errorMessage = error || 'OAuth authentication failed';
      logger.warn('Shared OAuth callback failed', { error: errorMessage, provider });
      return res.redirect(`${redirectUri}?error=${encodeURIComponent(String(errorMessage))}`);
    }
    if (!payload) {
      throw new AppError('No payload provided in callback', 400, ERROR_CODES.INVALID_INPUT);
    }

    const payloadData = JSON.parse(Buffer.from(payload as string, 'base64').toString('utf8'));
    let result;
    if (provider === 'google') {
      // Handle Google OAuth payload
      const googleUserInfo = {
        sub: payloadData.providerId,
        email: payloadData.email,
        name: payloadData.name || '',
        userName: payloadData.userName || '',
        picture: payloadData.avatar || '',
      };
      result = await authService.findOrCreateGoogleUser(googleUserInfo);
    } else if (provider === 'github') {
      // Handle GitHub OAuth payload
      const githubUserInfo = {
        id: payloadData.providerId,
        login: payloadData.login || '',
        email: payloadData.email,
        name: payloadData.name || '',
        avatar_url: payloadData.avatar || '',
      };
      result = await authService.findOrCreateGitHubUser(githubUserInfo);
    } else if (provider === 'microsoft') {
      // Handle Microsoft OAuth payload
      const microsoftUserInfo = {
        id: payloadData.providerId,
        email: payloadData.email,
        name: payloadData.name || '',
        avatar_url: payloadData.avatar || '',
      };
      result = await authService.findOrCreateMicrosoftUser(microsoftUserInfo);
    } else if (provider === 'discord') {
      // Handle Discord OAuth payload
      const discordUserInfo = {
        id: payloadData.providerId,
        username: payloadData.username || '',
        email: payloadData.email,
        avatar: payloadData.avatar || '',
      };
      result = await authService.findOrCreateDiscordUser(discordUserInfo);
    } else if (provider === 'linkedin') {
      // Handle LinkedIn OAuth payload
      const linkedinUserInfo = {
        sub: payloadData.providerId,
        email: payloadData.email,
        name: payloadData.name || '',
        picture: payloadData.avatar || '',
      };
      result = await authService.findOrCreateLinkedInUser(linkedinUserInfo);
    } else if (provider === 'facebook') {
      // Handle Facebook OAuth payload
      const facebookUserInfo = {
        id: payloadData.providerId,
        email: payloadData.email,
        name: payloadData.name || '',
        picture: payloadData.picture || { data: { url: payloadData.avatar || '' } },
      };
      result = await authService.findOrCreateFacebookUser(facebookUserInfo);
    }

    const finalredirectUri = new URL(redirectUri);
    finalredirectUri.searchParams.set('access_token', result?.accessToken ?? '');
    finalredirectUri.searchParams.set('user_id', result?.user.id ?? '');
    finalredirectUri.searchParams.set('email', result?.user.email ?? '');
    finalredirectUri.searchParams.set('name', result?.user.name ?? '');
    res.redirect(finalredirectUri.toString());
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
        const stateData = jwt.verify(
          state as string,
          process.env.JWT_SECRET || 'default_secret'
        ) as {
          provider: string;
          redirectUri: string;
        };
        redirectUri = stateData.redirectUri || '/';
      } catch {
        // Invalid state
      }
    }

    if (!['google', 'github', 'facebook', 'discord', 'linkedin', 'microsoft'].includes(provider)) {
      throw new AppError('Invalid provider', 400, ERROR_CODES.INVALID_INPUT);
    }

    let result;

    if (provider === 'facebook') {
      if (!code) {
        throw new AppError('No authorization code provided', 400, ERROR_CODES.INVALID_INPUT);
      }

      const accessToken = await authService.exchangeFacebookCodeForToken(code as string);
      const facebookUserInfo = await authService.getFacebookUserInfo(accessToken);
      result = await authService.findOrCreateFacebookUser(facebookUserInfo);
    } else if (provider === 'google') {
      let id_token: string;

      if (token) {
        id_token = token as string;
      } else if (code) {
        const tokens = await authService.exchangeCodeToTokenByGoogle(code as string);
        id_token = tokens.id_token;
      } else {
        throw new AppError(
          'No authorization code or token provided',
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const googleUserInfo = await authService.verifyGoogleToken(id_token);
      result = await authService.findOrCreateGoogleUser(googleUserInfo);
    } else if (provider === 'github') {
      if (!code) {
        throw new AppError('No authorization code provided', 400, ERROR_CODES.INVALID_INPUT);
      }

      const accessToken = await authService.exchangeGitHubCodeForToken(code as string);
      const githubUserInfo = await authService.getGitHubUserInfo(accessToken);
      result = await authService.findOrCreateGitHubUser(githubUserInfo);
    } else if (provider === 'microsoft') {
      if (!code) {
        throw new AppError('No authorization code provided', 400, ERROR_CODES.INVALID_INPUT);
      }

      const accessToken = await authService.exchangeCodeToTokenByMicrosoft(code as string);
      const microsoftUserInfo = await authService.getMicrosoftUserInfo(accessToken.access_token);
      result = await authService.findOrCreateMicrosoftUser(microsoftUserInfo);
    } else if (provider === 'discord') {
      if (!code) {
        throw new AppError('No authorization code provided', 400, ERROR_CODES.INVALID_INPUT);
      }

      const accessToken = await authService.exchangeDiscordCodeForToken(code as string);
      const discordUserInfo = await authService.getDiscordUserInfo(accessToken);
      result = await authService.findOrCreateDiscordUser(discordUserInfo);
    } else if (provider === 'linkedin') {
      let id_token: string;

      if (token) {
        id_token = token as string;
      } else if (code) {
        const tokens = await authService.exchangeCodeToTokenByLinkedIn(code as string);
        id_token = tokens.id_token;
      } else {
        throw new AppError(
          'No authorization code or token provided',
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const linkedinUserInfo = await authService.verifyLinkedInToken(id_token);
      result = await authService.findOrCreateLinkedInUser(linkedinUserInfo);
    }
    // Create URL with JWT token and user info (like the working example)
    const finalredirectUri = new URL(redirectUri);
    finalredirectUri.searchParams.set('access_token', result?.accessToken ?? '');
    finalredirectUri.searchParams.set('user_id', result?.user.id ?? '');
    finalredirectUri.searchParams.set('email', result?.user.email ?? '');
    finalredirectUri.searchParams.set('name', result?.user.name ?? '');

    logger.info('OAuth callback successful, redirecting with token', {
      redirectUri: finalredirectUri.toString(),
      hasAccessToken: !!result?.accessToken,
      userId: result?.user.id,
    });

    // Redirect directly to the app with token in URL
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

// ============= OAuth Configuration Management Endpoints =============

// GET /api/auth/oauth/configs - List all OAuth configurations (public)
router.get('/configs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const configs = await oauthConfigService.getAllConfigs();

    const response: ListOAuthConfigsResponse = {
      data: configs,
      count: configs.length,
    };
    successResponse(res, response);
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
      const provider = req.params.provider;
      if (!provider || provider.length === 0 || provider.length > 50) {
        throw new AppError('Invalid provider name', 400, ERROR_CODES.INVALID_INPUT);
      }
      const config = await oauthConfigService.getConfigByProvider(provider);
      const clientSecret = await oauthConfigService.getClientSecretByProvider(provider);

      if (!config) {
        throw new AppError(
          `OAuth configuration for ${provider} not found`,
          404,
          ERROR_CODES.NOT_FOUND
        );
      }

      successResponse(res, { ...config, clientSecret });
    } catch (error) {
      logger.error('Failed to get OAuth configuration', { error, provider: req.params.provider });
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

export default router;
