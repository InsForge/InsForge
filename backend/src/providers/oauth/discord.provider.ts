import axios from 'axios';
import logger from '@/utils/logger.js';
import { getApiBaseUrl } from '@/utils/environment.js';
import { OAuthConfigService } from '@/services/auth/oauth-config.service.js';
import { OAuthProvider } from './base.provider.js';
import type { DiscordUserInfo, OAuthUserData } from '@/types/auth.js';

/**
 * Discord OAuth Service
 * Handles all Discord OAuth operations including URL generation, token exchange, and user info retrieval
 */
export class DiscordOAuthProvider implements OAuthProvider {
  private static instance: DiscordOAuthProvider;

  private constructor() {
    // Initialize OAuth helpers if needed
  }

  public static getInstance(): DiscordOAuthProvider {
    if (!DiscordOAuthProvider.instance) {
      DiscordOAuthProvider.instance = new DiscordOAuthProvider();
    }
    return DiscordOAuthProvider.instance;
  }

  /**
   * Generate Discord OAuth authorization URL
   */
  async generateOAuthUrl(state?: string): Promise<string> {
    const oAuthConfigService = OAuthConfigService.getInstance();
    const config = await oAuthConfigService.getConfigByProvider('discord');

    if (!config) {
      throw new Error('Discord OAuth not configured');
    }

    const selfBaseUrl = getApiBaseUrl();

    if (config?.useSharedKey) {
      if (!state) {
        logger.warn('Shared Discord OAuth called without state parameter');
        throw new Error('State parameter is required for shared Discord OAuth');
      }
      // Use shared keys if configured
      const cloudBaseUrl = process.env.CLOUD_API_HOST || 'https://api.insforge.dev';
      const redirectUri = `${selfBaseUrl}/api/auth/oauth/shared/callback/${state}`;
      const response = await axios.get(
        `${cloudBaseUrl}/auth/v1/shared/discord?redirect_uri=${encodeURIComponent(redirectUri)}`,
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
      return response.data.auth_url || response.data.url || '';
    }

    logger.debug('Discord OAuth Config (fresh from DB):', {
      clientId: config.clientId ? 'SET' : 'NOT SET',
    });

    const authUrl = new URL('https://discord.com/api/oauth2/authorize');
    authUrl.searchParams.set('client_id', config.clientId ?? '');
    authUrl.searchParams.set('redirect_uri', `${selfBaseUrl}/api/auth/oauth/discord/callback`);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', config.scopes ? config.scopes.join(' ') : 'identify email');
    if (state) {
      authUrl.searchParams.set('state', state);
    }

    return authUrl.toString();
  }

  /**
   * Exchange Discord code for access token
   */
  async exchangeCodeToToken(code: string): Promise<string> {
    const oAuthConfigService = OAuthConfigService.getInstance();
    const config = await oAuthConfigService.getConfigByProvider('discord');

    if (!config) {
      throw new Error('Discord OAuth not configured');
    }

    try {
      logger.info('Exchanging Discord code for token', {
        hasCode: !!code,
        clientId: config.clientId?.substring(0, 10) + '...',
      });

      const clientSecret = await oAuthConfigService.getClientSecretByProvider('discord');
      const selfBaseUrl = getApiBaseUrl();
      const response = await axios.post(
        'https://discord.com/api/oauth2/token',
        new URLSearchParams({
          client_id: config.clientId ?? '',
          client_secret: clientSecret ?? '',
          code,
          redirect_uri: `${selfBaseUrl}/api/auth/oauth/discord/callback`,
          grant_type: 'authorization_code',
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      if (!response.data.access_token) {
        throw new Error('Failed to get access token from Discord');
      }

      return response.data.access_token;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        logger.error('Discord token exchange failed', {
          status: error.response.status,
          error: error.response.data,
        });
        throw new Error(`Discord OAuth error: ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  }

  /**
   * Get Discord user info
   */
  async getUserInfo(accessToken: string): Promise<DiscordUserInfo> {
    try {
      const response = await axios.get('https://discord.com/api/users/@me', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      return {
        id: response.data.id,
        username: response.data.global_name || response.data.username,
        email: response.data.email,
        avatar: response.data.avatar
          ? `https://cdn.discordapp.com/avatars/${response.data.id}/${response.data.avatar}.png`
          : '',
      };
    } catch (error) {
      logger.error('Discord user info retrieval failed:', error);
      throw new Error(`Failed to get Discord user info: ${error}`);
    }
  }

  /**
   * Handle Discord OAuth callback
   */
  async handleCallback(payload: { code?: string; token?: string }): Promise<OAuthUserData> {
    if (!payload.code) {
      throw new Error('No authorization code provided');
    }

    const accessToken = await this.exchangeCodeToToken(payload.code);
    const discordUserInfo = await this.getUserInfo(accessToken);

    // Transform Discord user info to generic format
    const userName = discordUserInfo.username;
    const email = discordUserInfo.email || `${discordUserInfo.id}@users.noreply.discord.local`;
    return {
      provider: 'discord',
      providerId: discordUserInfo.id,
      email,
      userName,
      avatarUrl: discordUserInfo.avatar || '',
      identityData: discordUserInfo,
    };
  }

  /**
   * Handle shared callback payload transformation
   */
  handleSharedCallback(payloadData: Record<string, unknown>): OAuthUserData {
    const providerId = String(payloadData.providerId ?? '');
    const username = String(payloadData.username ?? '');
    const emailField = String(payloadData.email ?? '');
    const avatar = String(payloadData.avatar ?? '');

    const email = emailField || `${providerId}@users.noreply.discord.local`;

    return {
      provider: 'discord',
      providerId,
      email,
      userName: username,
      avatarUrl: avatar,
      identityData: payloadData,
    };
  }
}
