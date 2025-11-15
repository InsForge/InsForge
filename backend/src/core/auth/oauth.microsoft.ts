import axios from 'axios';
import logger from '@/utils/logger.js';
import { getApiBaseUrl } from '@/utils/environment';
import { OAuthConfigService } from './oauth.config';
import type { MicrosoftUserInfo } from '@/types/auth';
import type { CreateSessionResponse } from '@insforge/shared-schemas';

/**
 * Microsoft OAuth Service
 * Handles all Microsoft OAuth operations including URL generation, token exchange, and user info retrieval
 */
export class MicrosoftOAuthService {
  private static instance: MicrosoftOAuthService;

  private constructor() {
    // Initialize OAuth helpers if needed
  }

  public static getInstance(): MicrosoftOAuthService {
    if (!MicrosoftOAuthService.instance) {
      MicrosoftOAuthService.instance = new MicrosoftOAuthService();
    }
    return MicrosoftOAuthService.instance;
  }

  /**
   * Generate Microsoft OAuth authorization URL
   */
  async generateOAuthUrl(state?: string): Promise<string> {
    const oAuthConfigService = OAuthConfigService.getInstance();
    const config = await oAuthConfigService.getConfigByProvider('microsoft');
    if (!config) {
      throw new Error('Microsoft OAuth not configured');
    }

    const selfBaseUrl = getApiBaseUrl();

    // Note: shared-keys path not implemented for Microsoft; configure local keys
    const authUrl = new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
    authUrl.searchParams.set('client_id', config.clientId ?? '');
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('redirect_uri', `${selfBaseUrl}/api/auth/oauth/microsoft/callback`);
    authUrl.searchParams.set(
      'scope',
      config.scopes && config.scopes.length > 0
        ? config.scopes.join(' ')
        : 'openid email profile offline_access User.Read'
    );
    if (state) {
      authUrl.searchParams.set('state', state);
    }
    return authUrl.toString();
  }

  /**
   * Exchange Microsoft code for tokens
   */
  async exchangeCodeToToken(code: string): Promise<{ access_token: string; id_token?: string }> {
    const oAuthConfigService = OAuthConfigService.getInstance();
    const config = await oAuthConfigService.getConfigByProvider('microsoft');
    if (!config) {
      throw new Error('Microsoft OAuth not configured');
    }
    const clientSecret = await oAuthConfigService.getClientSecretByProvider('microsoft');
    const selfBaseUrl = getApiBaseUrl();

    const body = new URLSearchParams({
      client_id: config.clientId ?? '',
      client_secret: clientSecret ?? '',
      code,
      redirect_uri: `${selfBaseUrl}/api/auth/oauth/microsoft/callback`,
      grant_type: 'authorization_code',
      scope:
        config.scopes && config.scopes.length > 0
          ? config.scopes.join(' ')
          : 'openid email profile offline_access User.Read',
    });

    const response = await axios.post(
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      body.toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }
    );

    if (!response.data.access_token) {
      throw new Error('Failed to get access token from Microsoft');
    }
    return {
      access_token: response.data.access_token,
      id_token: response.data.id_token, // optional
    };
  }

  /**
   * Get Microsoft user info via Graph API
   */
  async getUserInfo(accessToken: string): Promise<MicrosoftUserInfo> {
    const userResp = await axios.get('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const data = userResp.data as {
      id: string;
      displayName?: string;
      userPrincipalName?: string;
      mail?: string | null;
    };

    const email = data.mail || data.userPrincipalName || `${data.id}@users.noreply.microsoft.com`;
    const name = data.displayName || data.userPrincipalName || email;

    return {
      id: data.id,
      email,
      name,
    };
  }

  /**
   * Handle Microsoft OAuth callback
   */
  async handleCallback(
    payload: { code?: string; token?: string },
    findOrCreateUser: (microsoftUserInfo: MicrosoftUserInfo) => Promise<CreateSessionResponse>
  ): Promise<CreateSessionResponse> {
    if (!payload.code) {
      throw new Error('No authorization code provided');
    }

    const tokens = await this.exchangeCodeToToken(payload.code);
    const microsoftUserInfo = await this.getUserInfo(tokens.access_token);
    return findOrCreateUser(microsoftUserInfo);
  }
}
