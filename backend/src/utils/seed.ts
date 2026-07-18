import { DatabaseManager } from '@/infra/database/database.manager.js';
import { isCloudEnvironment, getApiBaseUrl } from '@/utils/environment.js';
import logger from '@/utils/logger.js';
import { SecretService } from '@/services/secrets/secret.service.js';
import { StripeSyncService } from '@/services/payments/stripe/sync.service.js';
import { OAuthConfigService } from '@/services/auth/oauth-config.service.js';
import { OAuthProvidersSchema } from '@insforge/shared-schemas';
import { AuthConfigService } from '@/services/auth/auth-config.service.js';
import { TokenManager } from '@/infra/security/token.manager.js';

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
    const result = await client.query('SELECT COUNT(*) as count FROM auth.config');
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
    await client.query(
      `INSERT INTO auth.config (
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
      {
        provider: 'x',
        clientIdEnv: 'X_CLIENT_ID',
        clientSecretEnv: 'X_CLIENT_SECRET',
      },
      {
        provider: 'apple',
        clientIdEnv: 'APPLE_CLIENT_ID',
        clientSecretEnv: 'APPLE_CLIENT_SECRET',
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

// Create api key and seed startup defaults
export async function seedBackend(): Promise<void> {
  const secretService = SecretService.getInstance();

  const dbManager = DatabaseManager.getInstance();

  try {
    logger.info(`\n🚀 Insforge Backend Starting...`);

    // A backup restored from another instance leaves system.secrets full of
    // ciphertext this instance's key cannot decrypt; quarantine those rows
    // first so the initializers below regenerate reserved secrets instead of
    // the first decrypt failure aborting seeding entirely. Non-fatal: on a
    // healthy database this is a no-op.
    try {
      await secretService.quarantineUndecryptableSecrets();
    } catch (error) {
      logger.warn('Undecryptable-secret sweep failed; continuing seeding', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Initialize API key (from env or generate)
    const apiKey = await secretService.initializeApiKey();

    // Seed Stripe secret keys into the secret store so payment code has one lookup path.
    await StripeSyncService.getInstance().seedStripeKeysFromEnv();

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
      await seedDefaultAuthConfig();
    } else {
      await seedLocalOAuthConfigs();
    }

    // Initialize reserved secrets for edge functions
    if (!isCloudEnvironment()) {
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
    }

    // Add ANON_KEY for client SDKs and public edge function access.
    // Seeds from ACCESS_ANON_KEY env or generates an opaque `anon_...` key,
    // migrating any legacy JWT-format value left behind by older deployments.
    const anonKey = await secretService.initializeAnonKey();

    // Add INSFORGE_BASE_URL for edge functions to call back to API
    const existingBaseUrlSecret = await secretService.getSecretByKey('INSFORGE_BASE_URL');

    if (existingBaseUrlSecret === null) {
      await secretService.createSecret({
        key: 'INSFORGE_BASE_URL',
        isReserved: true,
        value: getApiBaseUrl(),
      });
      logger.info('✅ INSFORGE_BASE_URL secret initialized');
    }

    // Add JWT_SECRET so CLI/SDK can access it via secrets API
    const jwtSecret = process.env.JWT_SECRET;
    if (jwtSecret) {
      const existingJwtSecret = await secretService.getSecretByKey('JWT_SECRET');

      if (existingJwtSecret === null) {
        await secretService.createSecret({
          key: 'JWT_SECRET',
          isReserved: true,
          value: jwtSecret,
        });
        logger.info('✅ JWT_SECRET secret initialized');
      }
    }

    // Initialize and load JWT asymmetric keypair
    await secretService.initializeJwtKeyPair();
    await TokenManager.getInstance().ensureKeysLoaded();

    logger.info(`API key generated: ${apiKey}`);
    logger.info(`Anon key generated: ${anonKey}`);
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
