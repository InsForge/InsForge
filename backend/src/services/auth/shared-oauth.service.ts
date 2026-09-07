import crypto from 'crypto';
import { ERROR_CODES } from '@insforge/shared-schemas';
import { AppError } from '@/utils/errors.js';
import { appConfig } from '@/infra/config/app.config.js';
import { TokenManager } from '@/infra/security/token.manager.js';
import logger from '@/utils/logger.js';

const IDENTITY_TOKEN_TYPE = 'shared_oauth_identity';

// Binds a cloud identity assertion to one OAuth attempt: sent when the flow starts,
// re-derived when the callback lands.
function sharedOAuthFlowId(state: string): string {
  return crypto.createHash('sha256').update(state).digest('hex');
}

/**
 * Query string for the cloud shared-OAuth start endpoint. `sign` proves we hold this
 * project's JWT_SECRET, which is what lets the cloud bind its identity assertion to us.
 */
export function buildSharedOAuthInitQuery(redirectUri: string, state: string): string {
  // signCloudToken rejects an unset PROJECT_ID, so projectId is only safe to read after it
  const sign = TokenManager.getInstance().signCloudToken('Shared OAuth');

  return new URLSearchParams({
    redirect_uri: redirectUri,
    project_id: appConfig.cloud.projectId as string,
    sign,
    flow_id: sharedOAuthFlowId(state),
  }).toString();
}

/**
 * Verifies the identity the cloud OAuth proxy asserts on a shared-provider callback.
 *
 * The assertion travels through the user's browser, so none of it is identity until
 * the cloud signature, the project binding and the flow binding all hold.
 */
export class SharedOAuthService {
  private static instance: SharedOAuthService;

  private consumedTokens = new Map<string, number>();

  public static getInstance(): SharedOAuthService {
    if (!SharedOAuthService.instance) {
      SharedOAuthService.instance = new SharedOAuthService();
    }
    return SharedOAuthService.instance;
  }

  public async verifyIdentityToken(
    token: string,
    context: { provider: string; state: string }
  ): Promise<Record<string, unknown>> {
    const { payload } = await TokenManager.getInstance().verifyCloudToken(token);

    if (payload.type !== IDENTITY_TOKEN_TYPE) {
      throw this.reject('Cloud token is not a shared OAuth identity assertion', context.provider);
    }

    // verifyCloudToken only compares project ids when PROJECT_ID is set; an assertion
    // minted for another project must not be accepted just because ours is unset
    if (!appConfig.cloud.projectId || payload.projectId !== appConfig.cloud.projectId) {
      throw this.reject('Shared OAuth identity is for a different project', context.provider);
    }

    if (payload.provider !== context.provider) {
      throw this.reject('Shared OAuth identity is for a different provider', context.provider);
    }

    if (payload.sid !== sharedOAuthFlowId(context.state)) {
      throw this.reject('Shared OAuth identity is for a different login attempt', context.provider);
    }

    const identity = payload.identity;
    if (!identity || typeof identity !== 'object' || Array.isArray(identity)) {
      throw this.reject('Shared OAuth identity assertion carries no identity', context.provider);
    }

    this.consume(payload.jti, payload.exp, context.provider);

    return identity as Record<string, unknown>;
  }

  /**
   * Single-use enforcement: a callback URL that leaks (logs, history, referrer)
   * must not mint a second session while the assertion is still inside its lifetime.
   */
  private consume(jti: unknown, exp: unknown, provider: string): void {
    if (typeof jti !== 'string' || !jti || typeof exp !== 'number') {
      throw this.reject('Shared OAuth identity assertion is not single-use', provider);
    }

    const now = Date.now();
    for (const [seen, expiresAt] of this.consumedTokens) {
      if (expiresAt <= now) {
        this.consumedTokens.delete(seen);
      }
    }

    if (this.consumedTokens.has(jti)) {
      throw this.reject('Shared OAuth identity assertion was already used', provider);
    }

    this.consumedTokens.set(jti, exp * 1000);
  }

  private reject(message: string, provider: string): AppError {
    logger.warn('Rejected shared OAuth identity assertion', { reason: message, provider });
    return new AppError(message, 401, ERROR_CODES.AUTH_INVALID_CREDENTIALS);
  }
}
