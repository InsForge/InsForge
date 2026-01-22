const API_BASE = '/api';
const CSRF_COOKIE_NAME = 'insforge_csrf';

interface ApiError extends Error {
  response?: {
    data: unknown;
    status: number;
  };
}

export class ApiClient {
  private accessToken: string | null = null;
  private onAuthError?: () => void;
  private refreshPromise: Promise<boolean> | null = null;

  setAccessToken(token: string) {
    this.accessToken = token;
  }

  setCsrfToken(csrfToken: string) {
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toUTCString();
    document.cookie = `${CSRF_COOKIE_NAME}=${encodeURIComponent(csrfToken)}; expires=${expires}; path=/; SameSite=Lax`;
  }

  clearTokens() {
    this.accessToken = null;
    document.cookie = `${CSRF_COOKIE_NAME}=; max-age=0; path=/; SameSite=Lax`;
  }

  getAccessToken() {
    return this.accessToken;
  }

  getCsrfToken() {
    const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE_NAME}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : null;
  }

  setAuthErrorHandler(handler?: () => void) {
    this.onAuthError = handler;
  }

  async refreshAccessToken(): Promise<boolean> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      const csrfToken = this.getCsrfToken();
      if (!csrfToken) {
        return false;
      }

      try {
        const response = await fetch(`${API_BASE}/auth/refresh`, {
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
          this.setAccessToken(data.accessToken);
          if (data.csrfToken) {
            this.setCsrfToken(data.csrfToken);
          }
          return true;
        }
        return false;
      } catch {
        return false;
      }
    })();

    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  request<T = unknown>(
    endpoint: string,
    options: RequestInit & {
      returnFullResponse?: boolean;
      skipAuth?: boolean;
      skipRefresh?: boolean;
    } = {}
  ): Promise<T> {
    const url = `${API_BASE}${endpoint}`;
    const { skipAuth, skipRefresh, ...fetchOptions } = options;

    const makeRequest = async (isRetry = false): Promise<T> => {
      const headers: Record<string, string> = {
        ...(!skipAuth && this.accessToken && { Authorization: `Bearer ${this.accessToken}` }),
        ...((fetchOptions.headers as Record<string, string>) || {}),
      };

      if (fetchOptions.body && typeof fetchOptions.body === 'string') {
        headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      }

      const config: RequestInit = {
        ...fetchOptions,
        headers,
        credentials: 'include',
      };

      const response = await fetch(url, config);

      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
        } catch {
          const error: ApiError = new Error(`HTTP ${response.status}: ${response.statusText}`);
          error.response = { data: null, status: response.status };
          throw error;
        }

        if (response.status === 401 && !skipAuth && !skipRefresh && !isRetry) {
          const refreshed = await this.refreshAccessToken();
          if (refreshed) {
            return makeRequest(true);
          }
          this.clearTokens();
          if (this.onAuthError) {
            this.onAuthError();
          }
        }

        if (errorData.error && errorData.message) {
          const error: ApiError = new Error(errorData.message);
          error.response = { data: errorData, status: response.status };
          throw error;
        }

        const error: ApiError = new Error(`HTTP ${response.status}: ${JSON.stringify(errorData)}`);
        error.response = { data: errorData, status: response.status };
        throw error;
      }

      const text = await response.text();
      let responseData = null;
      try {
        responseData = text ? JSON.parse(text) : null;
      } catch {
        responseData = text;
      }

      const contentRange = response.headers.get('content-range');
      if (contentRange && Array.isArray(responseData)) {
        const match = contentRange.match(/(\d+)-(\d+)\/(\d+|\*)/);
        if (match) {
          const start = parseInt(match[1]);
          const end = parseInt(match[2]);
          const total = match[3] === '*' ? responseData.length : parseInt(match[3]);
          return {
            data: responseData,
            pagination: { offset: start, limit: end - start + 1, total },
          } as T;
        }
        return {
          data: responseData,
          pagination: { offset: 0, limit: 0, total: 0 },
        } as T;
      }

      return responseData as T;
    };

    return makeRequest();
  }

  withAccessToken(headers: Record<string, string> = {}) {
    return this.accessToken ? { ...headers, Authorization: `Bearer ${this.accessToken}` } : headers;
  }
}

export const apiClient = new ApiClient();
