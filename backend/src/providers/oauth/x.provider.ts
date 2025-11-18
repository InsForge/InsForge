import crypto from 'crypto';
import { XUserInfo, OAuthUserData } from '@/types/auth';
import { getApiBaseUrl } from '@/utils/environment';
import logger from '@/utils/logger';
import { OAuthProvider } from './base.provider.js';
import axios from 'axios';
import { OAuthConfigService } from '@/services/auth/oauth-config.service';

export class XOAuthProvider implements OAuthProvider {
  private static instance: XOAuthProvider;
  // OAuth helper for X(Twitter)
  private verifierCodes: Map<string, string>;

  private constructor() {
    this.verifierCodes = new Map();
  }

  public static getInstance(): XOAuthProvider {
    if (!XOAuthProvider.instance) {
      XOAuthProvider.instance = new XOAuthProvider();
    }
    return XOAuthProvider.instance;
  }

  /**
   * Generate X OAuth authorization URL
   */
  async generateOAuthUrl(state?: string): Promise<string> {
    const oauthConfigService = OAuthConfigService.getInstance();
    const config = await oauthConfigService.getConfigByProvider('x');
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

    if (!config) {
      throw new Error('X OAuth not configured');
    }

    const selfBaseUrl = getApiBaseUrl();

    if (!state) {
      throw new Error('State parameter is required.');
    }
    this.verifierCodes.set(state, verifier);
    setTimeout(() => {
      this.verifierCodes.delete(state);
    }, 600000);

    if (config?.useSharedKey) {
      // Use shared keys if configured
      const cloudBasedUrl = process.env.CLOUD_API_HOST || 'https://api.insforge.dev';
      const redirectUri = `${selfBaseUrl}/api/auth/oauth/shared/callback/${state}`;
      const response = await axios.get(
        `${cloudBasedUrl}/oauth/twitter?redirect_uri=${encodeURIComponent(redirectUri)}`,
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
      return response.data.auth_url || response.data.url || '';
    }

    logger.debug('X OAuth Config (fresh from DB):', {
      clientId: config.clientId ? 'SET' : 'NOT SET',
    });

    const authUrl = new URL('https://twitter.com/i/oauth2/authorize');
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', config.clientId ?? '');
    authUrl.searchParams.set('redirect_uri', `${selfBaseUrl}/api/auth/oauth/x/callback`);
    authUrl.searchParams.set(
      'scope',
      config.scopes ? config.scopes.join(' ') : 'tweet.read users.read'
    );
    authUrl.searchParams.set('state', state ?? '');
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    return authUrl.toString();
  }

  /**
   *  Exchange X code for access token
   */
  async exchangeXCodeForToken(code: string, state: string): Promise<string> {
    const verifier = this.verifierCodes.get(state);

    if (!verifier) {
      throw new Error('Missing or expired PKCE verifier for this state');
    }

    // Immediately remove it to prevent replay
    this.verifierCodes.delete(state);

    const oauthConfigService = OAuthConfigService.getInstance();
    const config = await oauthConfigService.getConfigByProvider('x');

    if (!config) {
      throw new Error('X OAuth not configured');
    }

    const clientSecret = await oauthConfigService.getClientSecretByProvider('x');
    const selfBaseUrl = getApiBaseUrl();

    const body = new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      client_id: config.clientId ?? '',
      redirect_uri: `${selfBaseUrl}/api/auth/oauth/x/callback`,
      code_verifier: verifier,
    });

    const response = await axios.post('https://api.twitter.com/2/oauth2/token', body.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization:
          'Basic ' + Buffer.from(`${config.clientId}:${clientSecret}`).toString('base64'),
      },
    });

    if (!response.data.access_token) {
      throw new Error('Failed to get access token from X');
    }

    return response.data.access_token;
  }

  /**
   * Get X user info
   */
  async getXUserInfo(accessToken: string): Promise<XUserInfo> {
    const userResponse = await axios.get('https://api.twitter.com/2/users/me', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      params: {
        'user.fields': 'id,name,username,profile_image_url,verified',
      },
    });

    const userData = userResponse.data.data;

    return {
      id: userData.id,
      name: userData.name,
      username: userData.username,
      profile_image_url: userData.profile_image_url,
      verified: userData.verified,
    };
  }

  /**
   * Handle X OAuth callback
   */
  async handleCallback(payload: {
    code?: string;
    token?: string;
    state?: string;
  }): Promise<OAuthUserData> {
    if (!payload.code || !payload.state) {
      throw new Error('No authorization code or state provided');
    }

    const accessToken = await this.exchangeXCodeForToken(payload.code, payload.state);
    const xUserInfo = await this.getXUserInfo(accessToken);

    // Transform X user info to generic format
    const userName = xUserInfo.username || xUserInfo.name || `user${xUserInfo.id.substring(0, 8)}`;
    const email = `${userName}@users.noreply.x.local`;

    return {
      provider: 'x',
      providerId: xUserInfo.id,
      email,
      userName,
      avatarUrl: xUserInfo.profile_image_url || '',
      identityData: xUserInfo,
    };
  }

  /**
   * Handle shared callback payload transformation
   */
  handleSharedCallback(payloadData: Record<string, unknown>): OAuthUserData {
    const providerId = String(payloadData.providerId ?? '');
    const username = String(payloadData.username ?? '');
    const name = String(payloadData.name ?? '');
    const profileImageUrl = String(payloadData.profile_image_url ?? '');

    const userName = username || name || `user${providerId.substring(0, 8)}`;
    const email = `${userName}@users.noreply.x.local`;

    return {
      provider: 'x',
      providerId,
      email,
      userName,
      avatarUrl: profileImageUrl,
      identityData: payloadData,
    };
  }
}
