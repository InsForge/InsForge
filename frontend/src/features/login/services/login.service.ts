import { apiClient } from '@/lib/api/client';
import type { UserSchema } from '@insforge/shared-schemas';

interface LoginResult {
  user: UserSchema;
  accessToken: string;
  csrfToken?: string;
}

export class LoginService {
  async loginWithPassword(email: string, password: string): Promise<LoginResult> {
    const response = await apiClient.request('/auth/admin/sessions', {
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
    const response = await apiClient.request('/auth/admin/sessions/exchange', {
      method: 'POST',
      body: JSON.stringify({ code }),
      skipRefresh: true,
    });

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
    const response = await apiClient.request('/auth/sessions/current');
    return response.user;
  }

  async refreshAccessToken(): Promise<boolean> {
    const csrfToken = apiClient.getCsrfToken();
    if (!csrfToken) {
      return false;
    }

    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        credentials: 'include',
      });

      if (!response.ok) {
        return false;
      }

      const data = await response.json();
      if (data.accessToken) {
        apiClient.setAccessToken(data.accessToken);
        if (data.csrfToken) {
          apiClient.setCsrfToken(data.csrfToken);
        }
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  setAuthErrorHandler(handler?: () => void): void {
    apiClient.setAuthErrorHandler(handler);
  }
}

export const loginService = new LoginService();
