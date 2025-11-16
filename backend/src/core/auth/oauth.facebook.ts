import axios from 'axios';
import logger from '@/utils/logger.js';
import { getApiBaseUrl } from '@/utils/environment';
import { OAuthConfigService } from './oauth.config';
import type { FacebookUserInfo, OAuthUserData } from '@/types/auth';

/**
 * Facebook OAuth Service
 * Handles all Facebook OAuth operations including URL generation, token exchange, and user info retrieval
 */
export class FacebookOAuthService {
  private static instance: FacebookOAuthService;

  private constructor() {
    // Initialize OAuth helpers if needed
  }

  public static getInstance(): FacebookOAuthService {
    if (!FacebookOAuthService.instance) {
      FacebookOAuthService.instance = new FacebookOAuthService();
    }
    return FacebookOAuthService.instance;
  }

  /**
   * Generate Facebook OAuth authorization URL
   */
  async generateOAuthUrl(state?: string): Promise<string> {
    const oAuthConfigService = OAuthConfigService.getInstance();
    const config = await oAuthConfigService.getConfigByProvider('facebook');

    if (!config) {
      throw new Error('Facebook OAuth not configured');
    }

    const selfBaseUrl = getApiBaseUrl();

    if (config?.useSharedKey) {
      if (!state) {
        logger.warn('Shared Facebook OAuth called without state parameter');
        throw new Error('State parameter is required for shared Facebook OAuth');
      }
      const cloudBaseUrl = process.env.CLOUD_API_HOST || 'https://api.insforge.dev';
      const redirectUri = `${selfBaseUrl}/api/auth/oauth/shared/callback/${state}`;
      const response = await axios.get(
        `${cloudBaseUrl}/auth/v1/shared/facebook?redirect_uri=${encodeURIComponent(redirectUri)}`,
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
      return response.data.auth_url || response.data.url || '';
    }

    logger.debug('Facebook OAuth Config (fresh from DB):', {
      clientId: config.clientId ? 'SET' : 'NOT SET',
    });

    const authUrl = new URL('https://www.facebook.com/v21.0/dialog/oauth');
    authUrl.searchParams.set('client_id', config.clientId ?? '');
    authUrl.searchParams.set('redirect_uri', `${selfBaseUrl}/api/auth/oauth/facebook/callback`);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set(
      'scope',
      config.scopes ? config.scopes.join(',') : 'email,public_profile'
    );
    if (state) {
      authUrl.searchParams.set('state', state);
    }

    return authUrl.toString();
  }

  /**
   * Exchange Facebook code for access token
   */
  async exchangeCodeToToken(code: string): Promise<string> {
    const oAuthConfigService = OAuthConfigService.getInstance();
    const config = await oAuthConfigService.getConfigByProvider('facebook');

    if (!config) {
      throw new Error('Facebook OAuth not configured');
    }

    try {
      logger.info('Exchanging Facebook code for token', {
        hasCode: !!code,
        clientId: config.clientId?.substring(0, 10) + '...',
      });

      const clientSecret = await oAuthConfigService.getClientSecretByProvider('facebook');
      const selfBaseUrl = getApiBaseUrl();
      const response = await axios.get('https://graph.facebook.com/v21.0/oauth/access_token', {
        params: {
          client_id: config.clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: `${selfBaseUrl}/api/auth/oauth/facebook/callback`,
        },
      });

      if (!response.data.access_token) {
        throw new Error('Failed to get access token from Facebook');
      }

      return response.data.access_token;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        logger.error('Facebook token exchange failed', {
          status: error.response.status,
          error: error.response.data,
        });
        throw new Error(`Facebook OAuth error: ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  }

  /**
   * Get Facebook user info
   */
  async getUserInfo(accessToken: string): Promise<FacebookUserInfo> {
    try {
      const response = await axios.get('https://graph.facebook.com/v21.0/me', {
        params: {
          fields: 'id,email,name,first_name,last_name,picture',
          access_token: accessToken,
        },
      });

      return response.data;
    } catch (error) {
      logger.error('Facebook user info retrieval failed:', error);
      throw new Error(`Failed to get Facebook user info: ${error}`);
    }
  }

  /**
   * Handle Facebook OAuth callback
   */
  async handleCallback(payload: { code?: string; token?: string }): Promise<OAuthUserData> {
    if (!payload.code) {
      throw new Error('No authorization code provided');
    }

    const accessToken = await this.exchangeCodeToToken(payload.code);
    const facebookUserInfo = await this.getUserInfo(accessToken);

    // Transform Facebook user info to generic format
    const email = facebookUserInfo.email || '';
    const userName =
      facebookUserInfo.name ||
      facebookUserInfo.first_name ||
      `User${facebookUserInfo.id.substring(0, 6)}`;
    const avatarUrl = facebookUserInfo.picture?.data?.url || '';
    return {
      provider: 'facebook',
      providerId: facebookUserInfo.id,
      email,
      userName,
      avatarUrl,
      identityData: facebookUserInfo,
    };
  }

  /**
   * Handle shared callback payload transformation
   */
  handleSharedCallback(payloadData: Record<string, unknown>): OAuthUserData {
    const providerId = String(payloadData.providerId ?? '');
    const email = String(payloadData.email ?? '');
    const name = String(payloadData.name ?? '');
    const firstName = String(payloadData.first_name ?? '');
    const avatar = String(payloadData.avatar ?? '');

    // Handle nested picture.data.url structure
    const picture = payloadData.picture as { data?: { url?: string } } | undefined;
    const pictureUrl = picture?.data?.url ?? '';

    const userName = name || firstName || `User${providerId.substring(0, 6)}`;
    const avatarUrl = pictureUrl || avatar;

    return {
      provider: 'facebook',
      providerId,
      email,
      userName,
      avatarUrl,
      identityData: payloadData,
    };
  }
}
