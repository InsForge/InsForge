import { apiClient } from '@/lib/api/client';
import type {
  CreateAdminSessionResponse,
  GetCurrentSessionResponse,
  UserSchema,
} from '@insforge/shared-schemas';

interface LoginResult {
  user: UserSchema;
  accessToken: string;
  csrfToken?: string;
}

export class LoginService {
  async loginWithPassword(email: string, password: string): Promise<LoginResult> {
    const response = await apiClient.request<CreateAdminSessionResponse>('/auth/admin/sessions', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      skipRefresh: true,
    });

    if (!response.user || !response.accessToken) {
      throw new Error('Invalid login response');
    }

    apiClient.setAccessToken(response.accessToken);
    if (response.csrfToken) {
      apiClient.setCsrfToken(response.csrfToken);
    }

    return {
      user: response.user,
      accessToken: response.accessToken,
      csrfToken: response.csrfToken ?? undefined,
    };
  }

  async loginWithAuthorizationCode(code: string): Promise<LoginResult> {
    const response = await apiClient.request<CreateAdminSessionResponse>(
      '/auth/admin/sessions/exchange',
      {
        method: 'POST',
        body: JSON.stringify({ code }),
        skipRefresh: true,
      }
    );

    if (!response.user || !response.accessToken) {
      throw new Error('Invalid authorization code exchange response');
    }

    apiClient.setAccessToken(response.accessToken);
    if (response.csrfToken) {
      apiClient.setCsrfToken(response.csrfToken);
    }

    return {
      user: response.user,
      accessToken: response.accessToken,
      csrfToken: response.csrfToken ?? undefined,
    };
  }

  async logout(): Promise<void> {
    try {
      await apiClient.request('/auth/logout', {
        method: 'POST',
        skipRefresh: true,
      });
    } catch {
      // Ignore errors during logout
    }
    apiClient.clearTokens();
  }

  async getCurrentUser(): Promise<UserSchema | null> {
    const hasToken = !!apiClient.getAccessToken();
    const hasCsrf = !!apiClient.getCsrfToken();

    if (!hasToken && hasCsrf) {
      const refreshed = await apiClient.refreshAccessToken();
      if (!refreshed) {
        apiClient.clearTokens();
        return null;
      }
    }

    if (!apiClient.getAccessToken()) {
      return null;
    }

    const response = await apiClient.request<GetCurrentSessionResponse>('/auth/sessions/current');
    return response.user;
  }

  setAuthErrorHandler(handler?: () => void): void {
    apiClient.setAuthErrorHandler(handler);
  }
}

export const loginService = new LoginService();
