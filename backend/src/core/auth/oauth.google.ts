import axios from 'axios';
import { OAuth2Client } from 'google-auth-library';
import logger from '@/utils/logger.js';
import { getApiBaseUrl } from '@/utils/environment';
import { OAuthConfigService } from './oauth.config';
import type { GoogleUserInfo, OAuthUserData } from '@/types/auth';

/**
 * Google OAuth Service
 * Handles all Google OAuth operations including URL generation, token exchange, and user info verification
 */
export class GoogleOAuthService {
  private static instance: GoogleOAuthService;
  private processedCodes: Set<string>;
  private tokenCache: Map<string, { access_token: string; id_token: string }>;

  private constructor() {
    // Initialize OAuth helpers
    this.processedCodes = new Set();
    this.tokenCache = new Map();
  }

  public static getInstance(): GoogleOAuthService {
    if (!GoogleOAuthService.instance) {
      GoogleOAuthService.instance = new GoogleOAuthService();
    }
    return GoogleOAuthService.instance;
  }

  /**
   * Generate Google OAuth authorization URL
   */
  async generateOAuthUrl(state?: string): Promise<string> {
    const oauthConfigService = OAuthConfigService.getInstance();
    const config = await oauthConfigService.getConfigByProvider('google');

    if (!config) {
      throw new Error('Google OAuth not configured');
    }

    const selfBaseUrl = getApiBaseUrl();

    if (config?.useSharedKey) {
      if (!state) {
        logger.warn('Shared Google OAuth called without state parameter');
        throw new Error('State parameter is required for shared Google OAuth');
      }
      // Use shared keys if configured
      const cloudBaseUrl = process.env.CLOUD_API_HOST || 'https://api.insforge.dev';
      const redirectUri = `${selfBaseUrl}/api/auth/oauth/shared/callback/${state}`;
      const response = await axios.get(
        `${cloudBaseUrl}/auth/v1/shared/google?redirect_uri=${encodeURIComponent(redirectUri)}`,
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
      return response.data.auth_url || response.data.url || '';
    }

    logger.debug('Google OAuth Config (fresh from DB):', {
      clientId: config.clientId ? 'SET' : 'NOT SET',
    });

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', config.clientId ?? '');
    authUrl.searchParams.set('redirect_uri', `${selfBaseUrl}/api/auth/oauth/google/callback`);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set(
      'scope',
      config.scopes ? config.scopes.join(' ') : 'openid email profile'
    );
    authUrl.searchParams.set('access_type', 'offline');
    if (state) {
      authUrl.searchParams.set('state', state);
    }

    return authUrl.toString();
  }

  /**
   * Exchange Google code for tokens
   */
  async exchangeCodeToToken(code: string): Promise<{ access_token: string; id_token: string }> {
    // Check cache first
    if (this.processedCodes.has(code)) {
      const cachedTokens = this.tokenCache.get(code);
      if (cachedTokens) {
        logger.debug('Returning cached tokens for already processed code.');
        return cachedTokens;
      }
      throw new Error('Authorization code is currently being processed.');
    }

    const oauthConfigService = OAuthConfigService.getInstance();
    const config = await oauthConfigService.getConfigByProvider('google');

    if (!config) {
      throw new Error('Google OAuth not configured');
    }

    try {
      this.processedCodes.add(code);

      logger.info('Exchanging Google code for tokens', {
        hasCode: !!code,
        clientId: config.clientId?.substring(0, 10) + '...',
      });

      const clientSecret = await oauthConfigService.getClientSecretByProvider('google');
      const selfBaseUrl = getApiBaseUrl();
      const response = await axios.post('https://oauth2.googleapis.com/token', {
        code,
        client_id: config.clientId,
        client_secret: clientSecret,
        redirect_uri: `${selfBaseUrl}/api/auth/oauth/google/callback`,
        grant_type: 'authorization_code',
      });

      if (!response.data.access_token || !response.data.id_token) {
        throw new Error('Failed to get tokens from Google');
      }

      const result = {
        access_token: response.data.access_token,
        id_token: response.data.id_token,
      };

      // Cache the successful token exchange
      this.tokenCache.set(code, result);

      // Set a timeout to clear the code and cache to prevent memory leaks
      setTimeout(() => {
        this.processedCodes.delete(code);
        this.tokenCache.delete(code);
      }, 60000); // 1 minute timeout

      return result;
    } catch (error) {
      // If the request fails, remove the code immediately to allow for a retry
      this.processedCodes.delete(code);

      if (axios.isAxiosError(error) && error.response) {
        logger.error('Google token exchange failed', {
          status: error.response.status,
          error: error.response.data,
        });
        throw new Error(`Google OAuth error: ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  }

  /**
   * Verify Google ID token and get user info
   */
  async verifyToken(idToken: string): Promise<GoogleUserInfo> {
    const oauthConfigService = OAuthConfigService.getInstance();
    const config = await oauthConfigService.getConfigByProvider('google');

    if (!config) {
      throw new Error('Google OAuth not configured');
    }

    const clientSecret = await oauthConfigService.getClientSecretByProvider('google');

    if (!clientSecret) {
      throw new Error('Google Client Secret not configured.');
    }

    // Create OAuth2Client with fresh config
    const googleClient = new OAuth2Client(config.clientId, clientSecret, config.redirectUri);

    try {
      // Properly verify the ID token with Google's servers
      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: config.clientId,
      });

      const payload = ticket.getPayload();
      if (!payload) {
        throw new Error('Invalid Google token payload');
      }

      return {
        sub: payload.sub,
        email: payload.email || '',
        email_verified: payload.email_verified || false,
        name: payload.name || '',
        picture: payload.picture || '',
        given_name: payload.given_name || '',
        family_name: payload.family_name || '',
        locale: payload.locale || '',
      };
    } catch (error) {
      logger.error('Google token verification failed:', error);
      throw new Error(`Google token verification failed: ${error}`);
    }
  }

  /**
   * Handle Google OAuth callback
   */
  async handleCallback(payload: { code?: string; token?: string }): Promise<OAuthUserData> {
    let googleUserInfo: GoogleUserInfo;

    if (payload.token) {
      googleUserInfo = await this.verifyToken(payload.token);
    } else if (payload.code) {
      const tokens = await this.exchangeCodeToToken(payload.code);
      googleUserInfo = await this.verifyToken(tokens.id_token);
    } else {
      throw new Error('No authorization code or token provided');
    }

    // Transform Google user info to generic format
    const userName = googleUserInfo.name || googleUserInfo.email.split('@')[0];
    return {
      provider: 'google',
      providerId: googleUserInfo.sub,
      email: googleUserInfo.email,
      userName,
      avatarUrl: googleUserInfo.picture || '',
      identityData: googleUserInfo,
    };
  }
}
