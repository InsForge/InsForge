import axios from 'axios';
import logger from '@/utils/logger.js';
import { getApiBaseUrl } from '@/utils/environment';
import { OAuthConfigService } from './oauth.config';
import type { GitHubUserInfo, GitHubEmailInfo } from '@/types/auth';
import type { CreateSessionResponse } from '@insforge/shared-schemas';

/**
 * GitHub OAuth Service
 * Handles all GitHub OAuth operations including URL generation, token exchange, and user info retrieval
 */
export class GitHubOAuthService {
  private static instance: GitHubOAuthService;

  private constructor() {
    // Initialize OAuth helpers if needed
  }

  public static getInstance(): GitHubOAuthService {
    if (!GitHubOAuthService.instance) {
      GitHubOAuthService.instance = new GitHubOAuthService();
    }
    return GitHubOAuthService.instance;
  }

  /**
   * Generate GitHub OAuth authorization URL
   */
  async generateOAuthUrl(state?: string): Promise<string> {
    const oAuthConfigService = OAuthConfigService.getInstance();
    const config = await oAuthConfigService.getConfigByProvider('github');

    if (!config) {
      throw new Error('GitHub OAuth not configured');
    }

    const selfBaseUrl = getApiBaseUrl();

    if (config?.useSharedKey) {
      if (!state) {
        logger.warn('Shared GitHub OAuth called without state parameter');
        throw new Error('State parameter is required for shared GitHub OAuth');
      }
      // Use shared keys if configured
      const cloudBaseUrl = process.env.CLOUD_API_HOST || 'https://api.insforge.dev';
      const redirectUri = `${selfBaseUrl}/api/auth/oauth/shared/callback/${state}`;
      const response = await axios.get(
        `${cloudBaseUrl}/auth/v1/shared/github?redirect_uri=${encodeURIComponent(redirectUri)}`,
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
      return response.data.auth_url || response.data.url || '';
    }

    logger.debug('GitHub OAuth Config (fresh from DB):', {
      clientId: config.clientId ? 'SET' : 'NOT SET',
    });

    const authUrl = new URL('https://github.com/login/oauth/authorize');
    authUrl.searchParams.set('client_id', config.clientId ?? '');
    authUrl.searchParams.set('redirect_uri', `${selfBaseUrl}/api/auth/oauth/github/callback`);
    authUrl.searchParams.set('scope', config.scopes ? config.scopes.join(' ') : 'user:email');
    if (state) {
      authUrl.searchParams.set('state', state);
    }

    return authUrl.toString();
  }

  /**
   * Exchange GitHub code for access token
   */
  async exchangeCodeToToken(code: string): Promise<string> {
    const oAuthConfigService = OAuthConfigService.getInstance();
    const config = await oAuthConfigService.getConfigByProvider('github');

    if (!config) {
      throw new Error('GitHub OAuth not configured');
    }

    const clientSecret = await oAuthConfigService.getClientSecretByProvider('github');
    const selfBaseUrl = getApiBaseUrl();
    const response = await axios.post(
      'https://github.com/login/oauth/access_token',
      {
        client_id: config.clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: `${selfBaseUrl}/api/auth/oauth/github/callback`,
      },
      {
        headers: {
          Accept: 'application/json',
        },
      }
    );

    if (!response.data.access_token) {
      throw new Error('Failed to get access token from GitHub');
    }

    return response.data.access_token;
  }

  /**
   * Get GitHub user info
   */
  async getUserInfo(accessToken: string): Promise<GitHubUserInfo> {
    const userResponse = await axios.get('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    // GitHub doesn't always return email in user endpoint
    let email = userResponse.data.email;

    if (!email) {
      const emailResponse = await axios.get('https://api.github.com/user/emails', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const primaryEmail = emailResponse.data.find((e: GitHubEmailInfo) => e.primary);
      email = primaryEmail ? primaryEmail.email : emailResponse.data[0]?.email;
    }

    return {
      id: userResponse.data.id,
      login: userResponse.data.login,
      name: userResponse.data.name,
      email: email || `${userResponse.data.login}@users.noreply.github.com`,
      avatar_url: userResponse.data.avatar_url,
    };
  }

  /**
   * Handle GitHub OAuth callback
   */
  async handleCallback(
    payload: { code?: string; token?: string },
    findOrCreateUser: (githubUserInfo: GitHubUserInfo) => Promise<CreateSessionResponse>
  ): Promise<CreateSessionResponse> {
    if (!payload.code) {
      throw new Error('No authorization code provided');
    }

    const accessToken = await this.exchangeCodeToToken(payload.code);
    const githubUserInfo = await this.getUserInfo(accessToken);
    return findOrCreateUser(githubUserInfo);
  }
}
