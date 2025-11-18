import type { OAuthUserData } from '@/types/auth';

/**
 * OAuth provider interface
 * Defines the contract that all OAuth providers must implement
 */
export interface OAuthProvider {
  /**
   * Generate OAuth authorization URL
   * @param state - Optional state parameter for CSRF protection
   * @returns Authorization URL
   */
  generateOAuthUrl(state?: string): Promise<string>;

  /**
   * Handle OAuth callback and exchange code/token for user info
   * @param payload - OAuth callback payload containing code or token
   * @returns User data from OAuth provider
   */
  handleCallback(payload: { code?: string; token?: string }): Promise<OAuthUserData>;

  /**
   * Handle shared OAuth callback (for shared keys)
   * Optional - not all providers support shared OAuth
   * @param payloadData - Payload data from shared OAuth callback
   * @returns User data transformed to standard format
   */
  handleSharedCallback?(payloadData: Record<string, unknown>): OAuthUserData;
}
