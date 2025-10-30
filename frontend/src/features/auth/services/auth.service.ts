import { apiClient } from '@/lib/api/client';
import {
  VerifyEmailRequest,
  CreateSessionRequest,
  CreateSessionResponse,
  CreateUserRequest,
  CreateUserResponse,
  SendVerificationEmailRequest,
  GetOauthUrlResponse,
  OAuthProvidersSchema,
} from '@insforge/shared-schemas';

export class AuthService {
  /**
   * Create a new user account (sign up)
   */
  async createUser(input: CreateUserRequest): Promise<CreateUserResponse> {
    return apiClient.request('/auth/users', {
      method: 'POST',
      body: JSON.stringify(input),
      skipAuth: true,
    });
  }

  /**
   * Create a session (sign in)
   */
  async createSession(input: CreateSessionRequest): Promise<CreateSessionResponse> {
    return apiClient.request('/auth/sessions', {
      method: 'POST',
      body: JSON.stringify(input),
      skipAuth: true,
    });
  }

  /**
   * Get OAuth authorization URL for a provider
   */
  async getOAuthUrl(
    provider: OAuthProvidersSchema,
    redirectUri: string
  ): Promise<GetOauthUrlResponse> {
    return apiClient.request(
      `/auth/oauth/${provider}?redirect_uri=${encodeURIComponent(redirectUri)}`,
      {
        skipAuth: true,
      }
    );
  }

  /**
   * Verify email with OTP
   * - With email: numeric OTP verification (email + otp where otp is 6-digit code)
   * - Without email: link OTP verification (otp is 64-char hex token)
   */
  async verifyEmail(input: VerifyEmailRequest): Promise<CreateSessionResponse> {
    return apiClient.request('/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify(input),
      skipAuth: true,
    });
  }

  /**
   * Send verification email with link (magic link)
   */
  async sendVerificationLink(input: SendVerificationEmailRequest): Promise<void> {
    return apiClient.request('/auth/email/send-verification-link', {
      method: 'POST',
      body: JSON.stringify(input),
      skipAuth: true,
    });
  }

  /**
   * Send verification email with code (6-digit OTP)
   */
  async sendVerificationCode(input: SendVerificationEmailRequest): Promise<void> {
    return apiClient.request('/auth/email/send-verification-code', {
      method: 'POST',
      body: JSON.stringify(input),
      skipAuth: true,
    });
  }
}

export const authService = new AuthService();
