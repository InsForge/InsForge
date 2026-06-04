import { apiClient } from '#lib/api/client';
import type {
  CreateAdminSessionResponse,
  GetCurrentAdminSessionResponse,
  ProjectAdminSchema,
} from '@insforge/shared-schemas';

export class LoginService {
  async loginWithPassword(username: string, password: string): Promise<CreateAdminSessionResponse> {
    const response = (await apiClient.request('/auth/admin/sessions', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
      skipRefresh: true,
    })) as CreateAdminSessionResponse;

    if (!response.sub || !response.accessToken) {
      throw new Error('Invalid login response');
    }

    apiClient.setAccessToken(response.accessToken);
    if (response.csrfToken) {
      apiClient.setCsrfToken(response.csrfToken);
    } else {
      apiClient.clearCsrfToken();
    }

    return {
      sub: response.sub,
      accessToken: response.accessToken,
      csrfToken: response.csrfToken ?? undefined,
    };
  }

  async loginWithAuthorizationCode(code: string): Promise<CreateAdminSessionResponse> {
    const response = (await apiClient.request('/auth/admin/sessions/exchange', {
      method: 'POST',
      body: JSON.stringify({ code }),
      skipRefresh: true,
    })) as CreateAdminSessionResponse;

    if (!response.sub || !response.accessToken) {
      throw new Error('Invalid authorization code exchange response');
    }

    apiClient.setAccessToken(response.accessToken);
    if (response.csrfToken) {
      apiClient.setCsrfToken(response.csrfToken);
    } else {
      apiClient.clearCsrfToken();
    }

    return {
      sub: response.sub,
      accessToken: response.accessToken,
      csrfToken: response.csrfToken ?? undefined,
    };
  }

  async logout(): Promise<void> {
    try {
      await apiClient.request('/auth/admin/logout', {
        method: 'POST',
        skipRefresh: true,
      });
    } catch {
      // Ignore errors during logout
    }
    apiClient.clearTokens();
  }

  async getCurrentUser(): Promise<ProjectAdminSchema | null> {
    try {
      const response = (await apiClient.request(
        '/auth/admin/sessions/current'
      )) as GetCurrentAdminSessionResponse;
      return response.projectAdmin ?? null;
    } catch {
      return null;
    }
  }

  async refreshAccessToken(): Promise<boolean> {
    const csrfToken = apiClient.getCsrfToken();
    if (!csrfToken) {
      return false;
    }

    try {
      const response = await apiClient.request('/auth/admin/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        skipRefresh: true,
      });

      if (response.accessToken) {
        apiClient.setAccessToken(response.accessToken);
        if (response.csrfToken) {
          apiClient.setCsrfToken(response.csrfToken);
        } else {
          apiClient.clearCsrfToken();
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
