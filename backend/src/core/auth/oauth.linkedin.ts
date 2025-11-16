import axios from 'axios';
import logger from '@/utils/logger.js';
import { getApiBaseUrl } from '@/utils/environment';
import { OAuthConfigService } from './oauth.config';
import type { LinkedInUserInfo, OAuthUserData } from '@/types/auth';

/**
 * LinkedIn OAuth Service
 * Handles all LinkedIn OAuth operations including URL generation, token exchange, and user info verification
 */
export class LinkedInOAuthService {
  private static instance: LinkedInOAuthService;
  private processedCodes: Set<string>;
  private tokenCache: Map<string, { access_token: string; id_token: string }>;

  private constructor() {
    // Initialize OAuth helpers
    this.processedCodes = new Set();
    this.tokenCache = new Map();
  }

  public static getInstance(): LinkedInOAuthService {
    if (!LinkedInOAuthService.instance) {
      LinkedInOAuthService.instance = new LinkedInOAuthService();
    }
    return LinkedInOAuthService.instance;
  }

  /**
   * Generate LinkedIn OAuth authorization URL
   */
  async generateOAuthUrl(state?: string): Promise<string> {
    const oAuthConfigService = OAuthConfigService.getInstance();
    const config = await oAuthConfigService.getConfigByProvider('linkedin');

    if (!config) {
      throw new Error('LinkedIn OAuth not configured');
    }

    const selfBaseUrl = getApiBaseUrl();

    if (config?.useSharedKey) {
      if (!state) {
        logger.warn('Shared LinkedIn OAuth called without state parameter');
        throw new Error('State parameter is required for shared LinkedIn OAuth');
      }
      const cloudBaseUrl = process.env.CLOUD_API_HOST || 'https://api.insforge.dev';
      const redirectUri = `${selfBaseUrl}/api/auth/oauth/shared/callback/${state}`;
      const response = await axios.get(
        `${cloudBaseUrl}/auth/v1/shared/linkedin?redirect_uri=${encodeURIComponent(redirectUri)}`,
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
      return response.data.auth_url || response.data.url || '';
    }

    logger.debug('LinkedIn OAuth Config (fresh from DB):', {
      clientId: config.clientId ? 'SET' : 'NOT SET',
    });

    const authUrl = new URL('https://www.linkedin.com/oauth/v2/authorization');
    authUrl.searchParams.set('client_id', config.clientId ?? '');
    authUrl.searchParams.set('redirect_uri', `${selfBaseUrl}/api/auth/oauth/linkedin/callback`);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set(
      'scope',
      config.scopes ? config.scopes.join(' ') : 'openid profile email'
    );
    if (state) {
      authUrl.searchParams.set('state', state);
    }

    return authUrl.toString();
  }

  /**
   * Exchange LinkedIn code for tokens
   */
  async exchangeCodeToToken(code: string): Promise<{ access_token: string; id_token: string }> {
    if (this.processedCodes.has(code)) {
      const cachedTokens = this.tokenCache.get(code);
      if (cachedTokens) {
        logger.debug('Returning cached tokens for already processed code.');
        return cachedTokens;
      }
      throw new Error('Authorization code is currently being processed.');
    }

    const oAuthConfigService = OAuthConfigService.getInstance();
    const config = await oAuthConfigService.getConfigByProvider('linkedin');

    if (!config) {
      throw new Error('LinkedIn OAuth not configured');
    }

    try {
      this.processedCodes.add(code);

      logger.info('Exchanging LinkedIn code for tokens', {
        hasCode: !!code,
        clientId: config.clientId?.substring(0, 10) + '...',
      });

      const clientSecret = await oAuthConfigService.getClientSecretByProvider('linkedin');
      const selfBaseUrl = getApiBaseUrl();
      const response = await axios.post(
        'https://www.linkedin.com/oauth/v2/accessToken',
        new URLSearchParams({
          code,
          client_id: config.clientId ?? '',
          client_secret: clientSecret ?? '',
          redirect_uri: `${selfBaseUrl}/api/auth/oauth/linkedin/callback`,
          grant_type: 'authorization_code',
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      if (!response.data.access_token || !response.data.id_token) {
        throw new Error('Failed to get tokens from LinkedIn');
      }

      const result = {
        access_token: response.data.access_token,
        id_token: response.data.id_token,
      };

      this.tokenCache.set(code, result);

      setTimeout(() => {
        this.processedCodes.delete(code);
        this.tokenCache.delete(code);
      }, 60000);

      return result;
    } catch (error) {
      this.processedCodes.delete(code);

      if (axios.isAxiosError(error) && error.response) {
        logger.error('LinkedIn token exchange failed', {
          status: error.response.status,
          error: error.response.data,
        });
        throw new Error(`LinkedIn OAuth error: ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  }

  /**
   * Verify LinkedIn ID token and get user info
   */
  async verifyToken(idToken: string): Promise<LinkedInUserInfo> {
    const oAuthConfigService = OAuthConfigService.getInstance();
    const config = await oAuthConfigService.getConfigByProvider('linkedin');

    if (!config) {
      throw new Error('LinkedIn OAuth not configured');
    }

    try {
      const { createRemoteJWKSet, jwtVerify } = await import('jose');
      const JWKS = createRemoteJWKSet(new URL('https://www.linkedin.com/oauth/openid/jwks'));

      const { payload } = await jwtVerify(idToken, JWKS, {
        issuer: 'https://www.linkedin.com/oauth',
        audience: config.clientId,
      });

      return {
        sub: String(payload.sub),
        email: (payload.email as string) || '',
        email_verified: Boolean(payload.email_verified),
        name: (payload.name as string) || '',
        picture: (payload.picture as string) || '',
        given_name: (payload.given_name as string) || '',
        family_name: (payload.family_name as string) || '',
        locale: (payload.locale as string) || '',
      };
    } catch (error) {
      logger.error('LinkedIn token verification failed:', error);
      throw new Error('LinkedIn token verification failed');
    }
  }

  /**
   * Handle LinkedIn OAuth callback
   */
  async handleCallback(payload: { code?: string; token?: string }): Promise<OAuthUserData> {
    let linkedinUserInfo: LinkedInUserInfo;

    if (payload.token) {
      linkedinUserInfo = await this.verifyToken(payload.token);
    } else if (payload.code) {
      const tokens = await this.exchangeCodeToToken(payload.code);
      linkedinUserInfo = await this.verifyToken(tokens.id_token);
    } else {
      throw new Error('No authorization code or token provided');
    }

    // Transform LinkedIn user info to generic format
    const userName = linkedinUserInfo.name || linkedinUserInfo.email.split('@')[0];
    return {
      provider: 'linkedin',
      providerId: linkedinUserInfo.sub,
      email: linkedinUserInfo.email,
      userName,
      avatarUrl: linkedinUserInfo.picture || '',
      identityData: linkedinUserInfo,
    };
  }
}
