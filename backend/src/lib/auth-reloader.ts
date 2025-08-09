import { betterAuth } from 'better-auth';
import { jwt } from 'better-auth/plugins/jwt';
import { bearer } from 'better-auth/plugins/bearer';
import { toNodeHandler } from 'better-auth/node';
import type { IncomingMessage, ServerResponse } from 'http';
import { customAuthPlugin } from './custom-auth-plugin';
import { BETTER_AUTH_SECRET, pool } from './better-auth.js';
import logger from '@/utils/logger.js';

interface OAuthProviderConfig {
  clientId: string;
  clientSecret: string;
  enabled: boolean;
  useSharedKeys?: boolean;
}

interface OAuthConfig {
  google: OAuthProviderConfig;
  github: OAuthProviderConfig;
}

// Insforge shared OAuth credentials (for development)
const SHARED_OAUTH_KEYS = {
  google: {
    clientId: process.env.INSFORGE_GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.INSFORGE_GOOGLE_CLIENT_SECRET || '',
  },
  github: {
    clientId: process.env.INSFORGE_GITHUB_CLIENT_ID || '',
    clientSecret: process.env.INSFORGE_GITHUB_CLIENT_SECRET || '',
  },
};

// Start with the default auth instance
import { auth as defaultAuth } from './better-auth.js';
let currentAuth = defaultAuth;
let isReloading = false;

// Load OAuth configuration from database
async function loadOAuthConfig(): Promise<OAuthConfig> {
  const config: OAuthConfig = {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      enabled: false,
      useSharedKeys: false,
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID || '',
      clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
      enabled: false,
      useSharedKeys: false,
    },
  };

  try {
    const result = await pool.query(
      "SELECT key, value FROM _config WHERE key LIKE $1",
      ['oauth_%']
    );
    
    for (const row of result.rows) {
      const [, provider, field] = row.key.split('_');
      if ((provider === 'google' || provider === 'github') && field) {
        const providerConfig = config[provider as 'google' | 'github'];
        if (field === 'clientId' && row.value) {
          providerConfig.clientId = row.value;
        } else if (field === 'clientSecret' && row.value && !row.value.includes('****')) {
          providerConfig.clientSecret = row.value;
        } else if (field === 'enabled') {
          providerConfig.enabled = row.value === 'true';
        } else if (field === 'useSharedKeys') {
          providerConfig.useSharedKeys = row.value === 'true';
        }
      }
    }
    
    // If useSharedKeys is true, use Insforge's shared credentials
    if (config.google.useSharedKeys && SHARED_OAUTH_KEYS.google.clientId) {
      config.google.clientId = SHARED_OAUTH_KEYS.google.clientId;
      config.google.clientSecret = SHARED_OAUTH_KEYS.google.clientSecret;
    }
    
    if (config.github.useSharedKeys && SHARED_OAUTH_KEYS.github.clientId) {
      config.github.clientId = SHARED_OAUTH_KEYS.github.clientId;
      config.github.clientSecret = SHARED_OAUTH_KEYS.github.clientSecret;
    }
    
    // Enable if credentials are present
    config.google.enabled = !!(config.google.clientId && config.google.clientSecret);
    config.github.enabled = !!(config.github.clientId && config.github.clientSecret);
    
    logger.info('OAuth config loaded from database', {
      googleEnabled: config.google.enabled,
      githubEnabled: config.github.enabled,
    });
  } catch (error) {
    logger.error('Failed to load OAuth config', { error });
  }

  return config;
}

// Reload auth with new OAuth configuration
export async function reloadAuth(): Promise<{ success: boolean; config: OAuthConfig }> {
  // Prevent concurrent reloads
  if (isReloading) {
    logger.warn('OAuth reload already in progress');
    throw new Error('OAuth reload already in progress');
  }
  
  isReloading = true;
  
  try {
    logger.info('Reloading OAuth configuration...');
    
    const oauthConfig = await loadOAuthConfig();
    
    // Create new Better Auth instance with same secret
    const newAuth = betterAuth({
      secret: BETTER_AUTH_SECRET, // Same secret ensures JWT compatibility
      database: pool,
      basePath: '/api/auth/v2',
      advanced: {
        database: {
          generateId: false,
        },
      },
      trustedOrigins: ['*'],
      user: { modelName: '_user' },
      session: { modelName: '_session' },
      account: { modelName: '_account' },
      verification: { modelName: '_verification' },
      jwks: { modelName: 'jwks' },
      emailAndPassword: { enabled: true },
      socialProviders: {
        google: {
          clientId: oauthConfig.google.clientId,
          clientSecret: oauthConfig.google.clientSecret,
          redirectURI: process.env.GOOGLE_REDIRECT_URI || '',
          enabled: oauthConfig.google.enabled,
        },
        github: {
          clientId: oauthConfig.github.clientId,
          clientSecret: oauthConfig.github.clientSecret,
          redirectURI: process.env.GITHUB_REDIRECT_URI || '',
          enabled: oauthConfig.github.enabled,
        },
      },
      plugins: [
        bearer(),
        customAuthPlugin,
        jwt({
          jwt: {
            expirationTime: '7d',
            definePayload: ({ user }) => ({
              sub: user.id,
              email: user.email,
              role: 'authenticated',
            }),
          },
        }),
      ],
    });
    
    // Swap the instance
    currentAuth = newAuth;
    
    logger.info('OAuth configuration reloaded successfully', {
      google: oauthConfig.google.enabled,
      github: oauthConfig.github.enabled,
    });
    
    return { success: true, config: oauthConfig };
  } catch (error) {
    logger.error('Failed to reload OAuth', { error });
    throw error;
  } finally {
    isReloading = false;
  }
}

// Dynamic handler that always uses current auth instance
export const dynamicAuthHandler = async (req: IncomingMessage, res: ServerResponse) => {
  const handler = toNodeHandler(currentAuth);
  return handler(req, res);
};

// Export current auth for compatibility
export const getCurrentAuth = () => currentAuth;