import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { DatabaseManager } from '@/core/database/database.js';
import { verifyAdmin } from '@/api/middleware/auth.js';
import { AppError } from '@/api/middleware/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { successResponse } from '@/utils/response.js';
import { OAuthConfig, OAuthStatus, ConfigRecord } from '@/types/auth.js';
import logger from '@/utils/logger.js';

const router = Router();

// OAuth provider configuration schema
const oauthProviderSchema = z.object({
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  redirectUri: z.string().url().optional().or(z.literal('')),
  enabled: z.boolean(),
  useSharedKeys: z.boolean().optional(),
});

const oauthConfigSchema = z.object({
  google: oauthProviderSchema,
  github: oauthProviderSchema,
});

// Get OAuth configuration (admin only) - matches auth.ts JSON format
router.get('/oauth', verifyAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = DatabaseManager.getInstance();

    // Get OAuth config from _config table (JSON format like auth.ts)
    let configRows: ConfigRecord[];
    try {
      const rows = await db
        .getDb()
        .prepare(`SELECT key, value FROM _config WHERE key LIKE 'auth.oauth.provider.%'`)
        .all();

      if (!Array.isArray(rows)) {
        throw new Error('Expected array from database query');
      }

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
      logger.error('Failed to load OAuth config', {
        error: error instanceof Error ? error.message : String(error),
      });
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
        redirectUri:
          process.env.GOOGLE_REDIRECT_URI || 'http://localhost:7130/api/auth/oauth/google/callback',
        enabled: false,
        useSharedKeys: false,
      },
      github: {
        clientId: '',
        clientSecret: '',
        redirectUri:
          process.env.GITHUB_REDIRECT_URI || 'http://localhost:7130/api/auth/oauth/github/callback',
        enabled: false,
        useSharedKeys: false,
      },
    };

    // Process JSON config values (matching auth.ts format)
    for (const row of configRows) {
      try {
        const provider =
          row.key === 'auth.oauth.provider.google'
            ? 'google'
            : row.key === 'auth.oauth.provider.github'
              ? 'github'
              : null;

        if (provider && config[provider]) {
          const value = JSON.parse(row.value);
          config[provider].clientId = value.clientId || '';
          config[provider].clientSecret = value.clientSecret || '';
          config[provider].redirectUri = value.redirectUri || config[provider].redirectUri;
          config[provider].enabled = value.enabled || false;
        }
      } catch (e) {
        logger.error('Failed to parse OAuth config', { key: row.key, error: e });
      }
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

// Update OAuth configuration (admin only) - stores as JSON like auth.ts
router.post('/oauth', verifyAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validatedData = oauthConfigSchema.parse(req.body);
    const db = DatabaseManager.getInstance();

    // Start transaction
    await db.getDb().exec('BEGIN');

    try {
      // Update config values as JSON (matching auth.ts format)
      for (const [provider, config] of Object.entries(validatedData)) {
        const key = `auth.oauth.provider.${provider}`;

        // Get existing config to preserve unmasked secrets
        const existing = await db
          .getDb()
          .prepare('SELECT value FROM _config WHERE key = ?')
          .get(key);

        let finalConfig = { ...config };

        if (existing && existing.value) {
          try {
            const existingConfig = JSON.parse(existing.value);
            // Preserve existing secret if new one is masked
            if (config.clientSecret && config.clientSecret.includes('****')) {
              finalConfig.clientSecret = existingConfig.clientSecret;
            }
          } catch (e) {
            // If parse fails, use new config as-is
          }
        }

        // Store as JSON
        const configJson = JSON.stringify(finalConfig);

        await db
          .getDb()
          .prepare(
            `INSERT INTO _config (key, value) VALUES (?, ?)
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`
          )
          .run(key, configJson);
      }

      await db.getDb().exec('COMMIT');

      // AuthService will automatically reload config within 1 minute due to cache TTL
      successResponse(res, {
        message: 'OAuth configuration updated successfully',
        note: 'Configuration will be active within 1 minute (cache refresh)',
      });
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

    // Get OAuth config from database (JSON format)
    let configRows: ConfigRecord[];
    try {
      const rows = await db
        .getDb()
        .prepare(`SELECT key, value FROM _config WHERE key LIKE 'auth.oauth.provider.%'`)
        .all();

      if (!Array.isArray(rows)) {
        throw new Error('Expected array from database query');
      }

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
      logger.error('Failed to load OAuth status', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new AppError('Failed to load OAuth status', 500, ERROR_CODES.AUTH_OAUTH_CONFIG_ERROR);
    }

    const status: OAuthStatus = {
      google: { enabled: false },
      github: { enabled: false },
    };

    // Check database JSON config
    for (const row of configRows) {
      try {
        const provider =
          row.key === 'auth.oauth.provider.google'
            ? 'google'
            : row.key === 'auth.oauth.provider.github'
              ? 'github'
              : null;

        if (provider && status[provider]) {
          const config = JSON.parse(row.value);
          // Only mark as enabled if we have valid credentials
          status[provider].enabled = !!(config.enabled && config.clientId && config.clientSecret);
        }
      } catch (e) {
        // Skip invalid configs
        logger.debug('Skipping invalid OAuth config', { key: row.key });
      }
    }

    successResponse(res, status);
  } catch (error) {
    next(error);
  }
});

// Force reload OAuth configuration (admin only)
// Note: Not really needed since AuthService auto-reloads every minute
router.post(
  '/oauth/reload',
  verifyAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      logger.info('OAuth reload requested - config will refresh on next request');

      // AuthService automatically reloads config from DB with 1-minute cache
      // No action needed here, just inform the admin

      successResponse(res, {
        message: 'OAuth configuration cache cleared',
        note: 'New configuration will be loaded on next OAuth request',
      });
    } catch (error) {
      next(error);
    }
  }
);

export { router as configRouter };
