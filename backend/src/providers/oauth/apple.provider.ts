import axios from 'axios';
import logger from '@/utils/logger.js';
import { getApiBaseUrl } from '@/utils/environment.js';
import { OAuthConfigService } from '@/services/auth/oauth-config.service.js';
import type { AppleUserInfo, OAuthUserData } from '@/types/auth.js';
import { OAuthProvider } from './base.provider.js';

/**
 * Apple OAuth Service
 * Handles all Apple Sign In operations including URL generation, token exchange, and user info verification
 *
 * Apple OAuth specifics:
 * - Uses OIDC with JWT id_token
 * - Callback receives POST request with code, id_token, and user data
 * - User info (name, email) is only provided on first authorization
 * - client_secret is a JWT signed with Apple's private key
 */
export class AppleOAuthProvider implements OAuthProvider {
  private static instance: AppleOAuthProvider;

  private constructor() {
    // No initialization needed - jose handles JWKS caching internally
  }

  public static getInstance(): AppleOAuthProvider {
    if (!AppleOAuthProvider.instance) {
      AppleOAuthProvider.instance = new AppleOAuthProvider();
    }
    return AppleOAuthProvider.instance;
  }

  /**
   * Generate Apple OAuth authorization URL
   */
  async generateOAuthUrl(state?: string): Promise<string> {
    const oAuthConfigService = OAuthConfigService.getInstance();
    const config = await oAuthConfigService.getConfigByProvider('apple');

    if (!config) {
      throw new Error('Apple OAuth not configured');
    }

    const selfBaseUrl = getApiBaseUrl();

    logger.debug('Apple OAuth Config (fresh from DB):', {
      clientId: config.clientId ? 'SET' : 'NOT SET',
    });

    const authUrl = new URL('https://appleid.apple.com/auth/authorize');
    authUrl.searchParams.set('client_id', config.clientId ?? '');
    authUrl.searchParams.set('redirect_uri', `${selfBaseUrl}/api/auth/oauth/apple/callback`);
    authUrl.searchParams.set('response_type', 'code id_token');
    authUrl.searchParams.set('response_mode', 'form_post');
    authUrl.searchParams.set(
      'scope',
      config.scopes && config.scopes.length > 0 ? config.scopes.join(' ') : 'name email'
    );
    if (state) {
      authUrl.searchParams.set('state', state);
    }

    return authUrl.toString();
  }

  /**
   * Generate Apple client secret (JWT signed with private key)
   * Apple requires a dynamically generated client_secret
   */
  private async generateClientSecret(): Promise<string> {
    const oAuthConfigService = OAuthConfigService.getInstance();
    const config = await oAuthConfigService.getConfigByProvider('apple');

    if (!config) {
      throw new Error('Apple OAuth not configured');
    }

    // Get additional config from client secret (stored as JSON with teamId, keyId, privateKey)
    const secretData = await oAuthConfigService.getClientSecretByProvider('apple');
    if (!secretData) {
      throw new Error('Apple OAuth client secret not configured');
    }

    let appleConfig: { teamId: string; keyId: string; privateKey: string };
    try {
      appleConfig = JSON.parse(secretData);
    } catch {
      throw new Error(
        'Apple OAuth client secret must be a JSON object with teamId, keyId, and privateKey'
      );
    }

    const { teamId, keyId, privateKey } = appleConfig;

    if (!teamId || !keyId || !privateKey) {
      throw new Error('Apple OAuth requires teamId, keyId, and privateKey in client secret');
    }

    // Use jose to sign the client secret JWT
    const { SignJWT, importPKCS8 } = await import('jose');

    const key = await importPKCS8(privateKey, 'ES256');

    const clientSecret = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: keyId })
      .setIssuer(teamId)
      .setSubject(config.clientId ?? '')
      .setAudience('https://appleid.apple.com')
      .setIssuedAt()
      .setExpirationTime('180d') // 180 days (Apple allows up to 6 months)
      .sign(key);

    return clientSecret;
  }

  /**
   * Exchange Apple authorization code for tokens
   */
  async exchangeCodeToToken(code: string): Promise<{ access_token: string; id_token: string }> {
    const oAuthConfigService = OAuthConfigService.getInstance();
    const config = await oAuthConfigService.getConfigByProvider('apple');

    if (!config) {
      throw new Error('Apple OAuth not configured');
    }

    try {
      logger.info('Exchanging Apple code for tokens', {
        hasCode: !!code,
        clientId: config.clientId?.substring(0, 10) + '...',
      });

      const clientSecret = await this.generateClientSecret();
      const selfBaseUrl = getApiBaseUrl();

      const body = new URLSearchParams({
        client_id: config.clientId ?? '',
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: `${selfBaseUrl}/api/auth/oauth/apple/callback`,
      });

      const response = await axios.post('https://appleid.apple.com/auth/token', body.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      if (!response.data.id_token) {
        throw new Error('Failed to get id_token from Apple');
      }

      return {
        access_token: response.data.access_token || '',
        id_token: response.data.id_token,
      };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        logger.error('Apple token exchange failed', {
          status: error.response.status,
          error: error.response.data,
        });
        throw new Error(`Apple OAuth error: ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  }

  /**
   * Verify Apple ID token and extract user info
   */
  async verifyIdToken(idToken: string): Promise<AppleUserInfo> {
    const oAuthConfigService = OAuthConfigService.getInstance();
    const config = await oAuthConfigService.getConfigByProvider('apple');

    if (!config) {
      throw new Error('Apple OAuth not configured');
    }

    try {
      const { createRemoteJWKSet, jwtVerify } = await import('jose');
      const JWKS = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

      const { payload } = await jwtVerify(idToken, JWKS, {
        issuer: 'https://appleid.apple.com',
        audience: config.clientId,
      });

      return {
        sub: String(payload.sub),
        email: (payload.email as string) || '',
        email_verified: payload.email_verified === 'true' || payload.email_verified === true,
        is_private_email: payload.is_private_email === 'true' || payload.is_private_email === true,
      };
    } catch (error) {
      logger.error('Apple ID token verification failed:', error);
      throw new Error(`Apple token verification failed: ${error}`);
    }
  }

  /**
   * Handle Apple OAuth callback
   * Note: Apple sends a POST request with form data
   */
  async handleCallback(payload: { code?: string; token?: string }): Promise<OAuthUserData> {
    let appleUserInfo: AppleUserInfo;

    if (payload.token) {
      // Token provided directly (e.g., from mobile app)
      appleUserInfo = await this.verifyIdToken(payload.token);
    } else if (payload.code) {
      // Exchange code for tokens
      const tokens = await this.exchangeCodeToToken(payload.code);
      appleUserInfo = await this.verifyIdToken(tokens.id_token);
    } else {
      throw new Error('No authorization code or token provided');
    }

    // Transform Apple user info to generic format
    // Note: Apple only provides name on first authorization, so we use email as fallback
    const userName = appleUserInfo.name || appleUserInfo.email.split('@')[0];
    return {
      provider: 'apple',
      providerId: appleUserInfo.sub,
      email: appleUserInfo.email,
      userName,
      avatarUrl: '', // Apple doesn't provide avatar
      identityData: appleUserInfo,
    };
  }

  /**
   * Handle shared callback payload transformation
   */
  handleSharedCallback(payloadData: Record<string, unknown>): OAuthUserData {
    const providerId = String(payloadData.providerId ?? '');
    const email = String(payloadData.email ?? '');
    const name = String(payloadData.name ?? '');

    return {
      provider: 'apple',
      providerId,
      email,
      userName: name || email.split('@')[0],
      avatarUrl: '',
      identityData: payloadData,
    };
  }
}
