import { DatabaseManager } from '@/core/database/manager.js';
import { AIConfigService } from '@/core/ai/config.js';
import { isCloudEnvironment } from '@/utils/environment.js';
import logger from '@/utils/logger.js';
import { SecretService } from '@/core/secrets/secrets';
import { OAuthConfigService } from '@/core/auth/oauth.js';

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
 * Seeds default AI configurations for cloud environments
 */
async function seedDefaultAIConfigs(): Promise<void> {
  // Only seed default AI configs in cloud environment
  if (!isCloudEnvironment()) {
    return;
  }

  const aiConfigService = new AIConfigService();

  // Check if AI configs already exist
  const existingConfigs = await aiConfigService.findAll();

  if (existingConfigs.length) {
    return;
  }

  await aiConfigService.create(
    ['text', 'image'],
    ['text'],
    'openrouter',
    'openai/gpt-4o',
    'You are a helpful assistant.'
  );

  await aiConfigService.create(
    ['text', 'image'],
    ['text', 'image'],
    'openrouter',
    'google/gemini-2.5-flash-image-preview'
  );

  logger.info('✅ Default AI models configured (cloud environment)');
}

/**
 * Seeds default OAuth configurations for Google and GitHub
 */
async function seedDefaultOAuthConfigs(): Promise<void> {
  const oauthService = OAuthConfigService.getInstance();

  try {
    // Check if OAuth configs already exist
    const existingConfigs = await oauthService.getAllConfigs();
    const existingProviders = existingConfigs.map((config) => config.provider.toLowerCase());

    // Seed Google OAuth config if not exists
    if (!existingProviders.includes('google')) {
      await oauthService.createConfig({
        provider: 'google',
        useSharedKey: true,
      });
      logger.info('✅ Default Google OAuth config created');
    }

    // Seed GitHub OAuth config if not exists
    if (!existingProviders.includes('github')) {
      await oauthService.createConfig({
        provider: 'github',
        useSharedKey: true,
      });
      logger.info('✅ Default GitHub OAuth config created');
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
  const oauthService = OAuthConfigService.getInstance();

  try {
    // Check if OAuth configs already exist
    const existingConfigs = await oauthService.getAllConfigs();
    const existingProviders = existingConfigs.map((config) => config.provider.toLowerCase());

    // Seed Google OAuth config from environment variables if credentials exist
    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (googleClientId && googleClientSecret && !existingProviders.includes('google')) {
      await oauthService.createConfig({
        provider: 'google',
        clientId: googleClientId,
        clientSecret: googleClientSecret,
        scopes: ['openid', 'email', 'profile'],
        useSharedKey: false,
      });
      logger.info('✅ Google OAuth config loaded from environment variables');
    }

    // Seed GitHub OAuth config from environment variables if credentials exist
    const githubClientId = process.env.GITHUB_CLIENT_ID;
    const githubClientSecret = process.env.GITHUB_CLIENT_SECRET;

    if (githubClientId && githubClientSecret && !existingProviders.includes('github')) {
      await oauthService.createConfig({
        provider: 'github',
        clientId: githubClientId,
        clientSecret: githubClientSecret,
        scopes: ['user:email'],
        useSharedKey: false,
      });
      logger.info('✅ GitHub OAuth config loaded from environment variables');
    }
  } catch (error) {
    logger.warn('Failed to seed local OAuth configs', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// Create api key, admin user, and default AI configs
export async function seedBackend(): Promise<void> {
  const secretService = new SecretService();
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

    // seed AI configs for cloud environment
    await seedDefaultAIConfigs();

    // add default OAuth configs in Cloud hosting
    if (isCloudEnvironment()) {
      await seedDefaultOAuthConfigs();
    } else {
      await seedLocalOAuthConfigs();
    }

    // Initialize reserved secrets for edge functions
    // Add INSFORGE_INTERNAL_URL for Deno-to-backend container communication
    const insforgInternalUrl = 'http://insforge:7130';
    const existingSecret = await secretService.getSecretByKey('INSFORGE_INTERNAL_URL');

    if (existingSecret === null) {
      await secretService.createSecret({
        key: 'INSFORGE_INTERNAL_URL',
        isReserved: true,
        value: insforgInternalUrl,
      });
      logger.info('✅ System secrets initialized');
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
