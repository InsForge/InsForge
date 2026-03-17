import crypto from 'crypto';
import axios from 'axios';
import { getApiBaseUrl } from '@/utils/environment.js';
import { CustomOAuthConfigService } from '@/services/auth/custom-oauth-config.service.js';
import type { OAuthUserData } from '@/types/auth.js';

interface DiscoveredEndpoints {
  authorization_endpoint?: string;
  token_endpoint?: string;
  userinfo_endpoint?: string;
}

interface ResolvedEndpoints {
  authorizationUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
}

export class CustomOAuthProvider {
  private static instance: CustomOAuthProvider;
  private readonly customConfigService: CustomOAuthConfigService;
  private readonly REQUEST_TIMEOUT_MS = 10_000;
  private readonly VERIFIER_EXPIRY_MS = 10 * 60 * 1000;
  private verifierCodes: Map<string, string> = new Map();

  private constructor() {
    this.customConfigService = CustomOAuthConfigService.getInstance();
  }

  public static getInstance(): CustomOAuthProvider {
    if (!CustomOAuthProvider.instance) {
      CustomOAuthProvider.instance = new CustomOAuthProvider();
    }
    return CustomOAuthProvider.instance;
  }

  private async resolveEndpoints(key: string): Promise<ResolvedEndpoints> {
    const config = await this.customConfigService.getConfigByKey(key);
    if (!config) {
      throw new Error(`Custom OAuth provider ${key} is not configured.`);
    }

    let discovered: DiscoveredEndpoints;
    try {
      const response = await axios.get<DiscoveredEndpoints>(config.discoveryEndpoint, {
        timeout: this.REQUEST_TIMEOUT_MS,
      });
      discovered = response.data || {};
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const details =
          typeof error.response?.data === 'string'
            ? error.response.data
            : JSON.stringify(error.response?.data ?? {});
        throw new Error(
          `Failed to fetch discovery document for ${key} at ${config.discoveryEndpoint} (status ${status ?? 'n/a'}): ${details || error.message}`
        );
      }
      throw new Error(
        `Failed to fetch discovery document for ${key}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    const authorizationUrl = discovered.authorization_endpoint;
    const tokenUrl = discovered.token_endpoint;
    const userInfoUrl = discovered.userinfo_endpoint;

    if (!authorizationUrl || !tokenUrl || !userInfoUrl) {
      throw new Error(
        `Discovery document for ${key} is missing required endpoints (authorization_endpoint, token_endpoint, userinfo_endpoint).`
      );
    }

    return { authorizationUrl, tokenUrl, userInfoUrl };
  }

  async generateOAuthUrl(key: string, state: string): Promise<string> {
    const config = await this.customConfigService.getConfigByKey(key);
    if (!config) {
      throw new Error(`Custom OAuth provider ${key} is not configured.`);
    }

    const { authorizationUrl } = await this.resolveEndpoints(key);
    const callbackUrl = `${getApiBaseUrl()}/api/auth/oauth/custom/${key}/callback`;

    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    this.verifierCodes.set(state, verifier);
    setTimeout(() => this.verifierCodes.delete(state), this.VERIFIER_EXPIRY_MS);

    const url = new URL(authorizationUrl);
    url.searchParams.set('client_id', config.clientId);
    url.searchParams.set('redirect_uri', callbackUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid profile email');
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('code_challenge', challenge);

    return url.toString();
  }

  async handleCallback(key: string, code: string, state: string): Promise<OAuthUserData> {
    const config = await this.customConfigService.getConfigByKey(key);
    if (!config) {
      throw new Error(`Custom OAuth provider ${key} is not configured.`);
    }

    const clientSecret = await this.customConfigService.getClientSecretByKey(key);
    if (!clientSecret) {
      throw new Error(`Custom OAuth provider ${key} is missing client secret.`);
    }

    const verifier = this.verifierCodes.get(state);
    if (!verifier) {
      throw new Error(`Missing or expired PKCE verifier for custom provider ${key}.`);
    }
    this.verifierCodes.delete(state);

    const { tokenUrl, userInfoUrl } = await this.resolveEndpoints(key);
    const callbackUrl = `${getApiBaseUrl()}/api/auth/oauth/custom/${key}/callback`;

    const tokenRequestData = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: callbackUrl,
      client_id: config.clientId,
      client_secret: clientSecret,
      code_verifier: verifier,
    });

    let tokenPayload: { access_token?: string; error?: string; error_description?: string };
    try {
      const tokenResponse = await axios.post(tokenUrl, tokenRequestData.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: this.REQUEST_TIMEOUT_MS,
      });
      tokenPayload = tokenResponse.data as { access_token?: string };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const data = (error.response?.data ?? {}) as {
          error?: string;
          error_description?: string;
        };
        const message = data.error_description || data.error || error.message;
        throw new Error(
          `Custom OAuth provider ${key} token exchange failed: ${message} (status ${status ?? 'n/a'})`
        );
      }
      throw new Error(
        `Custom OAuth provider ${key} token exchange failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    if (!tokenPayload.access_token) {
      throw new Error(`Custom OAuth provider ${key} token response missing access_token.`);
    }

    let profile: Record<string, unknown>;
    try {
      const profileResponse = await axios.get<Record<string, unknown>>(userInfoUrl, {
        headers: { Authorization: `Bearer ${tokenPayload.access_token}` },
        timeout: this.REQUEST_TIMEOUT_MS,
      });
      profile = profileResponse.data || {};
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const details =
          typeof error.response?.data === 'string'
            ? error.response.data
            : JSON.stringify(error.response?.data ?? {});
        throw new Error(
          `Failed to fetch user profile for ${key} from ${userInfoUrl} (status ${status ?? 'n/a'}): ${details || error.message}`
        );
      }
      throw new Error(
        `Failed to fetch user profile for ${key}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    const providerIdRaw = profile.sub ?? profile.id ?? profile.user_id;
    const emailRaw = profile.email;
    const nameRaw = profile.name ?? profile.preferred_username ?? '';
    const pictureRaw = profile.picture ?? profile.avatar_url ?? '';

    if (
      providerIdRaw !== null &&
      providerIdRaw !== undefined &&
      typeof providerIdRaw !== 'string' &&
      typeof providerIdRaw !== 'number'
    ) {
      throw new Error(
        `Custom OAuth provider ${key} returned non-scalar user identifier (sub/id/user_id).`
      );
    }

    const providerId =
      providerIdRaw === null || providerIdRaw === undefined ? '' : String(providerIdRaw);
    const email = typeof emailRaw === 'string' ? emailRaw : '';
    const userName = typeof nameRaw === 'string' ? nameRaw : '';
    const avatarUrl = typeof pictureRaw === 'string' ? pictureRaw : '';

    if (!providerId || !email) {
      throw new Error(
        `Custom OAuth provider ${key} profile must include a user identifier (sub/id) and email.`
      );
    }

    return {
      provider: key,
      providerId,
      email,
      userName: userName || email.split('@')[0] || providerId,
      avatarUrl,
      identityData: profile,
    };
  }
}
