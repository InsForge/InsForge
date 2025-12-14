import { DatabaseManager } from '@/infra/database/database.manager.js';
import { TokenManager } from '@/infra/security/token.manager.js';
import { AIConfigService } from '@/services/ai/ai-config.service.js';
import { isCloudEnvironment } from '@/utils/environment.js';
import logger from '@/utils/logger.js';
import { SecretService } from '@/services/secrets/secret.service.js';
import { OAuthConfigService } from '@/services/auth/oauth-config.service.js';
import { OAuthProvidersSchema, aiConfigurationInputSchema } from '@insforge/shared-schemas';
import { z } from 'zod';
import { AuthConfigService } from '@/services/auth/auth-config.service.js';
import { fetchS3Config } from '@/utils/s3-config-loader.js';

/**
 * Validates admin credentials are configured
 * Admin is authenticated via environment variables, not stored in DB
 */
function ensureFirstAdmin(adminEmail: string, adminPassword: string): void {
  if (adminEmail && adminPassword) {
    logger.info(`✅ Admin configured: ${adminEmail}`);
  } else {
    logger.warn('⚠️ Admin credentials not configured - check ADMIN_EMAIL and ADMIN_PASSWORD');
  }
}

/**
 * Seeds default AI configurations from S3 config
 */
async function seedDefaultAIConfigs(): Promise<void> {
  const aiConfigService = AIConfigService.getInstance();

  const existingConfigs = await aiConfigService.findAll();
  if (existingConfigs.length) {
    return;
  }

  const defaultModels =
    await fetchS3Config<z.infer<typeof aiConfigurationInputSchema>[]>('default-ai-models.json');

  if (!defaultModels || defaultModels.length === 0) {
    logger.warn('⚠️ No default AI models configured - add via dashboard or check S3 config');
    return;
  }

  const parsed = aiConfigurationInputSchema.array().safeParse(defaultModels);
  if (!parsed.success) {
    logger.error('❌ Invalid AI models configuration from S3', {
      error: parsed.error.message,
    });
    return;
  }

  const validatedModels = parsed.data;
  for (const model of validatedModels) {
    await aiConfigService.create(
      model.inputModality,
      model.outputModality,
      model.provider,
      model.modelId,
      model.systemPrompt
    );
  }

  logger.info(`✅ Default AI models configured (${validatedModels.length} models)`);
}

/**
 * Seeds default auth configuration for cloud environments
 * Enables email verification with code-based verification method
 * Only inserts config if table is empty (first startup, never configured)
 */
async function seedDefaultAuthConfig(): Promise<void> {
  const dbManager = DatabaseManager.getInstance();
  const pool = dbManager.getPool();
  const client = await pool.connect();

  try {
    const result = await client.query('SELECT COUNT(*) as count FROM _auth_configs');
    const hasConfig = result.rows.length > 0 && Number(result.rows[0].count) > 0;

    if (hasConfig) {
      const authConfigService = AuthConfigService.getInstance();
      const currentConfig = await authConfigService.getAuthConfig();
      logger.info(
        '✅ Email verification configured:',
        currentConfig.requireEmailVerification ? 'enabled' : 'disabled'
      );
      return;
    }

    // Table is empty - this is first startup, insert default cloud configuration
    // Note: Migration 016 will add verify_email_method, reset_password_method, sign_in_redirect_to
    // so we only insert fields that exist in migration 015
    await client.query(
      `INSERT INTO _auth_configs (
        require_email_verification,
        password_min_length,
        require_number,
        require_lowercase,
        require_uppercase,
        require_special_char
      ) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING`,
      [
        isCloudEnvironment(), // Enable email verification for cloud
        6, // password_min_length
        false, // require_number
        false, // require_lowercase
        false, // require_uppercase
        false, // require_special_char
      ]
    );

    logger.info('✅ Email verification enabled (cloud environment)');
  } catch (error) {
    logger.error('Failed to seed default auth config', {
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't throw - this is not critical for app startup
  } finally {
    client.release();
  }
}

/**
 * Seeds default OAuth configurations for supported providers
 */
async function seedDefaultOAuthConfigs(): Promise<void> {
  const oauthConfigService = OAuthConfigService.getInstance();

  try {
    // Check if OAuth configs already exist
    const existingConfigs = await oauthConfigService.getAllConfigs();
    const existingProviders = existingConfigs.map((config) => config.provider.toLowerCase());

    // Default providers to seed
    const defaultProviders: OAuthProvidersSchema[] = ['google', 'github'];

    for (const provider of defaultProviders) {
      if (!existingProviders.includes(provider)) {
        await oauthConfigService.createConfig({
          provider,
          useSharedKey: true,
        });
        logger.info(`✅ Default ${provider} OAuth config created`);
      }
    }
  } catch (error) {
    logger.warn('Failed to seed OAuth configs', {
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't throw error as OAuth configs are optional
  }
}

/**
 * Seeds OAuth configurations from local environment variables
 */
async function seedLocalOAuthConfigs(): Promise<void> {
  const oauthConfigService = OAuthConfigService.getInstance();

  try {
    // Check if OAuth configs already exist
    const existingConfigs = await oauthConfigService.getAllConfigs();
    const existingProviders = existingConfigs.map((config) => config.provider.toLowerCase());

    // Environment variable mappings for OAuth providers
    const envMappings: Array<{
      provider: OAuthProvidersSchema;
      clientIdEnv: string;
      clientSecretEnv: string;
    }> = [
      {
        provider: 'google',
        clientIdEnv: 'GOOGLE_CLIENT_ID',
        clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
      },
      {
        provider: 'github',
        clientIdEnv: 'GITHUB_CLIENT_ID',
        clientSecretEnv: 'GITHUB_CLIENT_SECRET',
      },
      {
        provider: 'discord',
        clientIdEnv: 'DISCORD_CLIENT_ID',
        clientSecretEnv: 'DISCORD_CLIENT_SECRET',
      },
      {
        provider: 'linkedin',
        clientIdEnv: 'LINKEDIN_CLIENT_ID',
        clientSecretEnv: 'LINKEDIN_CLIENT_SECRET',
      },
      {
        provider: 'microsoft',
        clientIdEnv: 'MICROSOFT_CLIENT_ID',
        clientSecretEnv: 'MICROSOFT_CLIENT_SECRET',
      },
    ];

    for (const { provider, clientIdEnv, clientSecretEnv } of envMappings) {
      const clientId = process.env[clientIdEnv];
      const clientSecret = process.env[clientSecretEnv];

      if (clientId && clientSecret && !existingProviders.includes(provider)) {
        await oauthConfigService.createConfig({
          provider,
          clientId,
          clientSecret,
          useSharedKey: false,
        });
        logger.info(`✅ ${provider} OAuth config loaded from environment variables`);
      }
    }
  } catch (error) {
    logger.warn('Failed to seed local OAuth configs', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// Create api key, admin user, and default AI configs
export async function seedBackend(): Promise<void> {
  const secretService = SecretService.getInstance();

  const dbManager = DatabaseManager.getInstance();

  const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'change-this-password';

  try {
    logger.info(`\n🚀 Insforge Backend Starting...`);

    // Validate admin credentials are configured
    ensureFirstAdmin(adminEmail, adminPassword);

    // Initialize API key (from env or generate)
    const apiKey = await secretService.initializeApiKey();

    // Get database stats
    const tables = await dbManager.getUserTables();

    logger.info(`✅ Database connected to PostgreSQL`, {
      host: process.env.POSTGRES_HOST || 'localhost',
      port: process.env.POSTGRES_PORT || '5432',
      database: process.env.POSTGRES_DB || 'insforge',
    });
    // Database connection info is already logged above

    if (tables.length) {
      logger.info(`✅ Found ${tables.length} user tables`);
    }

    // seed default configs for cloud environment
    if (isCloudEnvironment()) {
      await seedDefaultOAuthConfigs();
      await seedDefaultAIConfigs();
      await seedDefaultAuthConfig();
    } else {
      await seedLocalOAuthConfigs();
    }

    // Initialize reserved secrets for edge functions
    // Add INSFORGE_INTERNAL_URL for Deno-to-backend container communication
    const insforgInternalUrl = 'http://insforge:7130';
    const existingInternalUrlSecret = await secretService.getSecretByKey('INSFORGE_INTERNAL_URL');

    if (existingInternalUrlSecret === null) {
      await secretService.createSecret({
        key: 'INSFORGE_INTERNAL_URL',
        isReserved: true,
        value: insforgInternalUrl,
      });
      logger.info('✅ INSFORGE_INTERNAL_URL secret initialized');
    }

    // Add ANON_KEY for public edge function access
    const existingAnonKeySecret = await secretService.getSecretByKey('ANON_KEY');

    if (existingAnonKeySecret === null) {
      const tokenManager = TokenManager.getInstance();
      const anonToken = tokenManager.generateAnonToken();

      await secretService.createSecret({
        key: 'ANON_KEY',
        isReserved: true,
        value: anonToken,
      });
      logger.info('✅ ANON_KEY secret initialized');
    }

    logger.info(`API key generated: ${apiKey}`);
    logger.info(`Setup complete:
      - Save this API key for your apps!
      - Dashboard: http://localhost:7131
      - API: http://localhost:7130/api
    `);
  } catch (error) {
    logger.error('Error during setup', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
