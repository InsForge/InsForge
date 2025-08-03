import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { DatabaseManager } from '@/core/database/database.js';
import { verifyAdmin } from '@/api/middleware/auth.js';
import { AppError } from '@/api/middleware/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { successResponse } from '@/utils/response.js';
import { OAuthConfig, OAuthStatus, ConfigRecord } from '@/types/auth.js';

const router = Router();

// OAuth provider configuration schema
const oauthProviderSchema = z.object({
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  redirectUri: z.string().url().optional().or(z.literal('')),
  enabled: z.boolean(),
});

const oauthConfigSchema = z.object({
  google: oauthProviderSchema,
  github: oauthProviderSchema,
});

// Get OAuth configuration (admin only)
router.get('/oauth', verifyAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = DatabaseManager.getInstance();

    // Get OAuth config from _config table
    let configRows: ConfigRecord[];
    try {
      const rows = await db
        .getDb()
        .prepare(
          `
        SELECT key, value FROM _config WHERE key LIKE 'oauth_%'
      `
        )
        .all();

      // Validate the result is an array
      if (!Array.isArray(rows)) {
        throw new Error('Expected array from database query');
      }

      // Validate each row has the expected structure
      configRows = rows.map((row) => {
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
    } catch (error) {
      console.error('Failed to load OAuth config:', error);
      throw new AppError(
        'Failed to load OAuth configuration',
        500,
        ERROR_CODES.AUTH_OAUTH_CONFIG_ERROR
      );
    }

    // Parse config into structured format
    const config: OAuthConfig = {
      google: {
        clientId: '',
        clientSecret: '',
        redirectUri: '',
        enabled: false,
      },
      github: {
        clientId: '',
        clientSecret: '',
        redirectUri: '',
        enabled: false,
      },
    };

    // Process config values
    for (const row of configRows) {
      const [, provider, field] = row.key.split('_'); // oauth_google_clientId
      if (provider && field && (provider === 'google' || provider === 'github')) {
        const providerConfig = config[provider];
        if (field === 'enabled') {
          providerConfig.enabled = row.value === 'true';
        } else if (field === 'clientId') {
          providerConfig.clientId = row.value;
        } else if (field === 'clientSecret') {
          providerConfig.clientSecret = row.value;
        } else if (field === 'redirectUri') {
          providerConfig.redirectUri = row.value;
        }
      }
    }

    // Get redirect URIs from environment if not set
    if (!config.google.redirectUri) {
      config.google.redirectUri =
        process.env.GOOGLE_REDIRECT_URI ||
        `${req.protocol}://${req.get('host')}/api/auth/v1/callback`;
    }
    if (!config.github.redirectUri) {
      config.github.redirectUri =
        process.env.GITHUB_REDIRECT_URI ||
        `${req.protocol}://${req.get('host')}/api/auth/v1/callback`;
    }

    // Check environment variables for client ID/secret if not in database
    if (!config.google.clientId && process.env.GOOGLE_CLIENT_ID) {
      config.google.clientId = process.env.GOOGLE_CLIENT_ID;
    }
    if (!config.google.clientSecret && process.env.GOOGLE_CLIENT_SECRET) {
      config.google.clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    }
    if (!config.github.clientId && process.env.GITHUB_CLIENT_ID) {
      config.github.clientId = process.env.GITHUB_CLIENT_ID;
    }
    if (!config.github.clientSecret && process.env.GITHUB_CLIENT_SECRET) {
      config.github.clientSecret = process.env.GITHUB_CLIENT_SECRET;
    }

    // Mask client secrets for security
    if (config.google.clientSecret) {
      config.google.clientSecret = config.google.clientSecret.substring(0, 4) + '****';
    }
    if (config.github.clientSecret) {
      config.github.clientSecret = config.github.clientSecret.substring(0, 4) + '****';
    }

    successResponse(res, config);
  } catch (error) {
    next(error);
  }
});

// Update OAuth configuration (admin only)
router.post('/oauth', verifyAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validatedData = oauthConfigSchema.parse(req.body);
    const db = DatabaseManager.getInstance();

    // Start transaction
    await db.getDb().exec('BEGIN');

    try {
      // Update config values
      for (const [provider, config] of Object.entries(validatedData)) {
        for (const [field, value] of Object.entries(config)) {
          const key = `oauth_${provider}_${field}`;
          const stringValue = typeof value === 'boolean' ? value.toString() : value || '';

          // Don't update secrets if they're masked
          if (field === 'clientSecret' && stringValue.includes('****')) {
            continue;
          }

          await db
            .getDb()
            .prepare(
              `
            INSERT INTO _config (key, value) VALUES (?, ?)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
          `
            )
            .run(key, stringValue);
        }
      }

      await db.getDb().exec('COMMIT');

      successResponse(res, { message: 'OAuth configuration updated successfully' });
    } catch (error) {
      await db.getDb().exec('ROLLBACK');
      throw error;
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(
        new AppError(
          'Invalid OAuth configuration',
          400,
          ERROR_CODES.DATABASE_VALIDATION_ERROR,
          error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')
        )
      );
    } else {
      next(error);
    }
  }
});

// Get OAuth status (public endpoint)
router.get('/oauth/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = DatabaseManager.getInstance();

    // Get enabled status from config
    let enabledRows: ConfigRecord[];
    try {
      const rows = await db
        .getDb()
        .prepare(
          `
        SELECT key, value FROM _config WHERE key LIKE 'oauth_%_enabled'
      `
        )
        .all();

      // Validate the result is an array
      if (!Array.isArray(rows)) {
        throw new Error('Expected array from database query');
      }

      // Validate each row has the expected structure
      enabledRows = rows.map((row) => {
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
    } catch (error) {
      console.error('Failed to load OAuth status:', error);
      throw new AppError('Failed to load OAuth status', 500, ERROR_CODES.AUTH_OAUTH_CONFIG_ERROR);
    }

    const status: OAuthStatus = {
      google: { enabled: false },
      github: { enabled: false },
    };

    // Check database config first
    for (const row of enabledRows) {
      const [, provider] = row.key.split('_'); // oauth_google_enabled
      if (provider && (provider === 'google' || provider === 'github')) {
        status[provider].enabled = row.value === 'true';
      }
    }

    // Also check if environment variables are set (fallback)
    if (
      !status.google.enabled &&
      process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET
    ) {
      let googleEnabledConfig: { value: string } | null;
      try {
        const result = await db
          .getDb()
          .prepare(
            `
          SELECT value FROM _config WHERE key = 'oauth_google_enabled'
        `
          )
          .get();

        if (result && (typeof result !== 'object' || typeof result.value !== 'string')) {
          throw new Error('Invalid config structure');
        }

        googleEnabledConfig = result as { value: string } | null;
      } catch (error) {
        console.error('Failed to check Google OAuth status:', error);
        // Continue with default behavior on error
        googleEnabledConfig = null;
      }

      // Only enable if explicitly not disabled in database
      if (!googleEnabledConfig || googleEnabledConfig.value !== 'false') {
        status.google.enabled = true;
      }
    }

    if (
      !status.github.enabled &&
      process.env.GITHUB_CLIENT_ID &&
      process.env.GITHUB_CLIENT_SECRET
    ) {
      let githubEnabledConfig: { value: string } | null;
      try {
        const result = await db
          .getDb()
          .prepare(
            `
          SELECT value FROM _config WHERE key = 'oauth_github_enabled'
        `
          )
          .get();

        if (result && (typeof result !== 'object' || typeof result.value !== 'string')) {
          throw new Error('Invalid config structure');
        }

        githubEnabledConfig = result as { value: string } | null;
      } catch (error) {
        console.error('Failed to check GitHub OAuth status:', error);
        // Continue with default behavior on error
        githubEnabledConfig = null;
      }

      // Only enable if explicitly not disabled in database
      if (!githubEnabledConfig || githubEnabledConfig.value !== 'false') {
        status.github.enabled = true;
      }
    }

    successResponse(res, status);
  } catch (error) {
    next(error);
  }
});

export { router as configRouter };
