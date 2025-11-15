import axios from 'axios';
import logger from '@/utils/logger.js';
import { getApiBaseUrl } from '@/utils/environment';
import { OAuthConfigService } from './oauth.config';
import type { DiscordUserInfo } from '@/types/auth';
import type { CreateSessionResponse } from '@insforge/shared-schemas';

/**
 * Discord OAuth Service
 * Handles all Discord OAuth operations including URL generation, token exchange, and user info retrieval
 */
export class DiscordOAuthService {
  private static instance: DiscordOAuthService;

  private constructor() {
    // Initialize OAuth helpers if needed
  }

  public static getInstance(): DiscordOAuthService {
    if (!DiscordOAuthService.instance) {
      DiscordOAuthService.instance = new DiscordOAuthService();
    }
    return DiscordOAuthService.instance;
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
      const authUrl = await fetch(
        `${cloudBaseUrl}/auth/v1/shared/discord?redirect_uri=${encodeURIComponent(redirectUri)}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
      if (!authUrl.ok) {
        logger.error('Failed to fetch Discord auth URL:', {
          status: authUrl.status,
          statusText: authUrl.statusText,
        });
        throw new Error(`Failed to fetch Discord auth URL: ${authUrl.statusText}`);
      }
      const responseData = (await authUrl.json()) as { auth_url?: string; url?: string };
      return responseData.auth_url || responseData.url || '';
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
  }

  /**
   * Get Discord user info
   */
  async getUserInfo(accessToken: string): Promise<DiscordUserInfo> {
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
  }

  /**
   * Handle Discord OAuth callback
   */
  async handleCallback(
    payload: { code?: string; token?: string },
    findOrCreateUser: (discordUserInfo: DiscordUserInfo) => Promise<CreateSessionResponse>
  ): Promise<CreateSessionResponse> {
    if (!payload.code) {
      throw new Error('No authorization code provided');
    }

    const accessToken = await this.exchangeCodeToToken(payload.code);
    const discordUserInfo = await this.getUserInfo(accessToken);
    return findOrCreateUser(discordUserInfo);
  }
}
