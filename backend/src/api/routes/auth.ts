import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { AuthService } from '@/core/auth/auth.js';
import { DatabaseManager } from '@/core/database/database.js';
import { AppError } from '@/api/middleware/error.js';
import { verifyUserOrAdmin, verifyAdmin, AuthRequest } from '@/api/middleware/auth.js';
import { successResponse } from '@/utils/response.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { validateEmail } from '@/utils/validations.js';
import { UserWithProfile } from '@/types/profile.js';
import { OAuthConfig, ConfigRecord } from '@/types/auth.js';
import logger from '@/utils/logger.js';

const router = Router();
const authService = AuthService.getInstance();

router.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password, name, id } = req.body;

    if (!email || !password) {
      throw new AppError(
        'Email and password are required',
        400,
        ERROR_CODES.MISSING_FIELD,
        'Email and password are required. Please fill in the email and password and try again.'
      );
    }

    if (!validateEmail(email)) {
      throw new AppError('Invalid Email format', 400, ERROR_CODES.INVALID_INPUT);
    }

    const existingUser = await authService.getUserByEmail(email);
    if (existingUser) {
      throw new AppError(
        'User already exists',
        400,
        ERROR_CODES.ALREADY_EXISTS,
        'User already exists. Please use a different email or login with the existing account.'
      );
    }

    // Check if provided ID already exists (treat empty string as no ID)
    if (id && id.trim() !== '') {
      const existingUserById = await authService.getUserById(id);
      if (existingUserById) {
        throw new AppError(
          'User with this ID already exists',
          400,
          ERROR_CODES.ALREADY_EXISTS,
          'User with this ID already exists. Please use a different ID or login with the existing account.'
        );
      }
    }

    // Pass undefined if ID is empty string to trigger auto-generation
    const userWithProfile = await authService.createUser(
      email,
      password,
      name,
      id && id.trim() !== '' ? id : undefined
    );
    const token = authService.generateToken({
      sub: userWithProfile.id,
      email: userWithProfile.email,
      role: 'authenticated',
      type: 'user',
    });

    // Log user creation activity
    const dbManager = DatabaseManager.getInstance();
    await dbManager.logActivity('INSERT', 'auth', userWithProfile.id, {
      email: userWithProfile.email,
    });
    await dbManager.logActivity('INSERT', 'profiles', userWithProfile.profile.id, {
      auth_id: userWithProfile.id,
      name: userWithProfile.profile.name,
    });

    // Traditional REST: return the resource directly
    successResponse(
      res,
      {
        user: {
          id: userWithProfile.id,
          email: userWithProfile.email,
          name: userWithProfile.profile.name,
          avatar_url: userWithProfile.profile.avatar_url,
          bio: userWithProfile.profile.bio,
        },
        access_token: token,
        message: 'User registered successfully',
        nextAction:
          'You can use this token to access other endpoints (always add it to HTTP Header "Authorization", then send requests). Please keep it safe.',
      },
      201
    );
  } catch (error) {
    next(error);
  }
});

router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      throw new AppError(
        'Email and password are required. Please fill in the email and password and try again.',
        400,
        ERROR_CODES.MISSING_FIELD
      );
    }

    const userWithProfile = await authService.authenticateUser(email, password);
    if (!userWithProfile) {
      throw new AppError(
        'Invalid credentials. Please check the email and password and try again.',
        401,
        ERROR_CODES.AUTH_INVALID_CREDENTIALS
      );
    }

    const token = authService.generateToken({
      sub: userWithProfile.id,
      email: userWithProfile.email,
      role: 'authenticated',
      type: 'user',
    });

    successResponse(res, {
      user: {
        id: userWithProfile.id,
        email: userWithProfile.email,
        name: userWithProfile.profile.name,
        avatar_url: userWithProfile.profile.avatar_url,
        bio: userWithProfile.profile.bio,
      },
      access_token: token,
      message: 'Login successful',
      nextAction:
        'You can use this token to access other endpoints (always add it to HTTP Header "Authorization", then send requests). Please keep it safe.',
    });
  } catch (error) {
    next(error);
  }
});

// Admin login route - separate from regular user login, uses _superuser table
router.post('/admin/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      throw new AppError(
        'Email and password are required. Please fill in the email and password and try again.',
        400,
        ERROR_CODES.MISSING_FIELD
      );
    }

    const superuser = await authService.authenticateSuperUser(email, password);
    if (!superuser) {
      throw new AppError(
        'Invalid admin credentials. Please check the email and password and try again.',
        401,
        ERROR_CODES.AUTH_INVALID_CREDENTIALS
      );
    }

    const token = authService.generateToken({
      sub: superuser.id,
      email: superuser.email,
      role: 'project_admin',
      type: 'admin',
    });

    successResponse(res, {
      user: {
        id: superuser.id,
        name: superuser.profile.name,
        email: superuser.email,
        role: 'admin',
      },
      access_token: token,
      message: 'Admin login successful',
      nextAction:
        'You can use this token to access admin endpoints (always add it to HTTP Header "Authorization", then send requests). Please keep it safe.',
    });
  } catch (error) {
    next(error);
  }
});

router.get('/me', verifyUserOrAdmin, (req: AuthRequest, res: Response) => {
  successResponse(res, {
    user: req.user,
  });
});

// Admin endpoint to get all users
router.get('/users', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const limit = Math.max(1, Math.min(parseInt(req.query.limit as string) || 20, 100));
    const offset = Math.max(0, parseInt(req.query.offset as string) || 0);
    const searchQuery = req.query.search as string;
    const [users, total] = await Promise.all([
      authService.getUsersWithPagination(offset, limit, searchQuery),
      authService.getUsersCount(searchQuery),
    ]);
    successResponse(res, {
      users: users.map((user) => ({
        id: user.id,
        email: user.email,
        name: user.profile.name,
        status: user.profile.metadata?.status || 'active',
        avatar_url: user.profile.avatar_url,
        bio: user.profile.bio,
        identities: user.identities,
        provider_type: user.identities.length > 0 ? 'Social' : 'Email',
        created_at: user.created_at,
        updated_at: user.updated_at,
      })),
      total,
    });
  } catch (error) {
    next(error);
  }
});

// Admin endpoint to bulk delete users
router.delete(
  '/users/bulk-delete',
  verifyUserOrAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      // Only admins can delete users
      if (req.user?.type !== 'admin') {
        throw new AppError(
          'Admin access required',
          403,
          ERROR_CODES.FORBIDDEN,
          'Only administrators can delete users.'
        );
      }

      const { userIds } = req.body;

      if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
        throw new AppError(
          'User IDs are required',
          400,
          ERROR_CODES.MISSING_FIELD,
          'Please provide an array of user IDs to delete.'
        );
      }

      // Validate that all userIds are strings
      if (!userIds.every((id) => typeof id === 'string' && id.trim().length > 0)) {
        throw new AppError(
          'Invalid user IDs',
          400,
          ERROR_CODES.INVALID_INPUT,
          'All user IDs must be valid non-empty strings.'
        );
      }

      const deletedCount = await authService.bulkDeleteUsers(userIds);

      // Log bulk deletion activity
      const dbManager = DatabaseManager.getInstance();
      await dbManager.logActivity('DELETE', 'auth', 'bulk', {
        deleted_count: deletedCount,
        user_ids: userIds,
        admin_id: req.user.id,
      });

      successResponse(res, {
        message: `Successfully deleted ${deletedCount} user(s)`,
        deletedCount,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Get Google OAuth authorization URL
router.get('/v1/google-auth', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { redirect_url } = req.query;

    // Create state parameter with client redirect URL and provider info
    let state = null;
    if (redirect_url) {
      const stateData = {
        client_redirect_uri: redirect_url,
        provider: 'google',
        csrf_token: crypto.randomBytes(32).toString('hex'), // Generate random CSRF token
        // TODO: need to save and verify the csrf_token and client_redirect_uri
      };
      state = Buffer.from(JSON.stringify(stateData)).toString('base64');
    }

    // Create authorization URL with state parameter
    const authUrl = await authService.generateGoogleAuthUrl(state || undefined);

    successResponse(res, {
      auth_url: authUrl,
    });
  } catch (error) {
    logger.error('Google OAuth error', {
      error: error instanceof Error ? error.message : String(error),
    });
    if (error instanceof Error && error.message.includes('environment variable is not set')) {
      next(
        new AppError(
          error.message,
          500,
          ERROR_CODES.AUTH_OAUTH_CONFIG_ERROR,
          'Google OAuth is not properly configured. Please check environment variables: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI'
        )
      );
    } else {
      next(error);
    }
  }
});

// Get GitHub OAuth authorization URL
router.get('/v1/github-auth', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { redirect_url } = req.query;
    let state = null;
    if (redirect_url) {
      const stateData = {
        client_redirect_uri: redirect_url,
        provider: 'github',
        csrf_token: crypto.randomBytes(32).toString('hex'),
      };
      state = Buffer.from(JSON.stringify(stateData)).toString('base64');
    }
    const authUrl = await authService.generateGitHubAuthUrl(state || undefined);
    successResponse(res, { auth_url: authUrl });
  } catch (error) {
    logger.error('GitHub OAuth error', {
      error: error instanceof Error ? error.message : String(error),
    });
    if (error instanceof Error && error.message.includes('environment variable is not set')) {
      next(
        new AppError(
          error.message,
          500,
          ERROR_CODES.AUTH_OAUTH_CONFIG_ERROR,
          'GitHub OAuth is not properly configured. Please check environment variables: GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GITHUB_REDIRECT_URI'
        )
      );
    } else {
      next(error);
    }
  }
});

// Unified OAuth callback endpoint
router.get('/v1/callback', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code, state, token } = req.query;

    // Parse state parameter to get client redirect URL and provider info
    let clientRedirectUri = '/';
    let provider: string | null = null;

    if (state) {
      try {
        const stateData = JSON.parse(Buffer.from(state as string, 'base64').toString());
        clientRedirectUri = stateData.client_redirect_uri || '/';
        // Check if provider is specified in state
        if (stateData.provider) {
          provider = stateData.provider;
        }
      } catch (error) {
        logger.error('Failed to parse state parameter', {
          error: error instanceof Error ? error.message : String(error),
        });
        // Fallback to default redirect
      }
    }

    // If no provider in state, try to determine from other sources
    if (!provider) {
      // Try to determine provider from referer header
      const referer = req.headers.referer;
      if (referer) {
        if (referer.includes('accounts.google.com')) {
          provider = 'google';
        } else if (referer.includes('github.com')) {
          provider = 'github';
        }
      }

      // If still no provider, check if we have a token parameter (Google specific)
      if (!provider && token) {
        provider = 'google';
      }
    }
    if (!provider) {
      throw new AppError(
        'No provider detected',
        400,
        ERROR_CODES.AUTH_INVALID_CREDENTIALS,
        'Callback state is invalid. You can retrieve the auth url with /api/auth/v1/google-auth or /api/auth/v1/github-auth endpoint and try again.'
      );
    }

    let userWithProfile: UserWithProfile | null = null;
    let providerId: string = '';

    try {
      if (provider === 'google') {
        // Handle Google OAuth
        let id_token = null;

        if (token) {
          // Direct callback with Google token
          id_token = token as string;
        } else if (code) {
          const tokens = await authService.exchangeCodeToTokenByGoogle(code as string);
          id_token = tokens.id_token;
        } else {
          throw new AppError(
            'Either authorization code or token is required',
            400,
            ERROR_CODES.MISSING_FIELD,
            'Callback url is invalid. Please check the authorization code or token in the query parameter'
          );
        }

        // Verify the Google token and get user info
        const googleUserInfo = await authService.verifyGoogleToken(id_token);
        userWithProfile = await authService.findOrCreateGoogleUser(googleUserInfo);
        providerId = googleUserInfo.sub;
      } else if (provider === 'github') {
        // Handle GitHub OAuth
        if (!code) {
          throw new AppError(
            'Authorization code is required',
            400,
            ERROR_CODES.MISSING_FIELD,
            'Callback url is invalid. Please check the authorization code in the query parameter'
          );
        }

        const accessToken = await authService.exchangeGitHubCodeForToken(code as string);
        const githubUserInfo = await authService.getGitHubUserInfo(accessToken);
        userWithProfile = await authService.findOrCreateGitHubUser(githubUserInfo);
        providerId = githubUserInfo.id.toString();
      } else {
        throw new AppError(
          'Invalid OAuth provider',
          400,
          ERROR_CODES.AUTH_UNSUPPORTED_PROVIDER,
          'Please check the provider in the state parameter'
        );
      }

      if (!userWithProfile) {
        throw new AppError(
          `Failed to authenticate with ${provider}`,
          401,
          ERROR_CODES.AUTH_INVALID_CREDENTIALS,
          `Failed to authenticate with ${provider}. Please check the provider and try again.`
        );
      }

      // Generate our own JWT token
      const generatedToken = authService.generateToken({
        sub: userWithProfile.id,
        email: userWithProfile.email,
        role: 'authenticated',
        type: 'user',
      });

      // Log user login activity
      const dbManager = DatabaseManager.getInstance();
      await dbManager.logActivity('LOGIN', 'auth', userWithProfile.id, {
        email: userWithProfile.email,
        provider,
        provider_id: providerId,
      });

      // Create URL with our JWT token and user info
      const redirectUrl = new URL(clientRedirectUri);
      redirectUrl.searchParams.set('access_token', generatedToken);
      redirectUrl.searchParams.set('user_id', userWithProfile.id);
      redirectUrl.searchParams.set('email', userWithProfile.email);
      redirectUrl.searchParams.set('name', userWithProfile.profile.name);

      // Redirect to the final URL
      return res.redirect(redirectUrl.toString());
    } catch (error) {
      logger.error('Error processing OAuth token', {
        provider,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new AppError(
        `Failed to verify ${provider} token, cause: ${error}`,
        401,
        ERROR_CODES.AUTH_INVALID_CREDENTIALS
      );
    }
  } catch (error) {
    logger.error('Error in OAuth callback', {
      error: error instanceof Error ? error.message : String(error),
    });
    next(error);
  }
});

// OAuth configuration endpoints
router.get(
  '/oauth/config',
  verifyUserOrAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (req.user?.type !== 'admin') {
        throw new AppError('Admin access required', 403, ERROR_CODES.FORBIDDEN);
      }

      const dbManager = DatabaseManager.getInstance();
      const db = dbManager.getDb();

      // Get OAuth configurations from database
      const rows = await db
        .prepare('SELECT key, value FROM _config WHERE key LIKE ?')
        .all('auth.oauth.provider.%');

      // Validate the result is an array
      if (!Array.isArray(rows)) {
        throw new Error('Expected array from database query');
      }

      // Validate each row has the expected structure
      const configs = rows.map((row) => {
        if (
          typeof row !== 'object' ||
          !row ||
          typeof row.key !== 'string' ||
          typeof row.value !== 'string'
        ) {
          throw new Error(`Invalid config row structure: ${JSON.stringify(row)}`);
        }
        return row as ConfigRecord;
      });

      const result: OAuthConfig = {
        google: { enabled: false, clientId: '', clientSecret: '' },
        github: { enabled: false, clientId: '', clientSecret: '' },
      };

      configs.forEach((config: ConfigRecord) => {
        try {
          let value;
          try {
            value = JSON.parse(config.value);
          } catch (parseError) {
            logger.error('Failed to parse JSON for config key', {
              key: config.key,
              error: parseError instanceof Error ? parseError.message : String(parseError),
            });
            return; // Skip this config entry
          }

          // Validate parsed value is an object
          if (typeof value !== 'object' || !value) {
            logger.error(`Invalid config value for ${config.key}: expected object`);
            return;
          }

          if (config.key === 'auth.oauth.provider.google') {
            result.google = {
              enabled: typeof value.enabled === 'boolean' ? value.enabled : false,
              clientId: typeof value.clientId === 'string' ? value.clientId : '',
              clientSecret: value.clientSecret ? String(value.clientSecret) : '', // Mask secret
            };
          } else if (config.key === 'auth.oauth.provider.github') {
            result.github = {
              enabled: typeof value.enabled === 'boolean' ? value.enabled : false,
              clientId: typeof value.clientId === 'string' ? value.clientId : '',
              clientSecret: value.clientSecret ? String(value.clientSecret) : '', // Mask secret
            };
          }
        } catch (e) {
          logger.error('Failed to process OAuth config', {
            key: config.key,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      });

      successResponse(res, result);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/oauth/config',
  verifyUserOrAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (req.user?.type !== 'admin') {
        throw new AppError('Admin access required', 403, ERROR_CODES.FORBIDDEN);
      }

      const { provider, clientId, clientSecret, enabled } = req.body;

      if (!provider || !['google', 'github'].includes(provider)) {
        throw new AppError(
          'Invalid provider',
          400,
          ERROR_CODES.INVALID_INPUT,
          'Provider must be either "google" or "github"'
        );
      }

      // Client ID can be empty when just updating enabled status
      // if (!clientId) {
      //   throw new AppError('Client ID is required', 400, ERROR_CODES.MISSING_FIELD);
      // }

      const dbManager = DatabaseManager.getInstance();
      const db = dbManager.getDb();

      const configKey = `auth.oauth.provider.${provider}`;
      const configValue = JSON.stringify({
        enabled: enabled !== undefined ? enabled : false,
        clientId,
        clientSecret: clientSecret || '',
      });

      // Upsert configuration
      await db
        .prepare(
          `INSERT INTO _config (key, value, created_at, updated_at) 
       VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET 
       value = excluded.value, 
       updated_at = CURRENT_TIMESTAMP`
        )
        .run(configKey, configValue);

      // Log configuration change
      await dbManager.logActivity('UPDATE', '_config', configKey, {
        provider,
        action: 'oauth_config_update',
      });

      successResponse(res, { message: `${provider} OAuth configuration updated successfully` });
    } catch (error) {
      next(error);
    }
  }
);

export { router as authRouter };
