const API_BASE = '/api';

interface ApiError extends Error {
  response?: {
    data: any;
    status: number;
  };
}

export class ApiClient {
  private token: string | null = null;
  private apiKey: string | null = null;
  private tokenRefreshPromise: Promise<void> | null = null;
  private onAuthError?: () => void;

  constructor() {
    this.token = localStorage.getItem('insforge_token');
    this.apiKey = localStorage.getItem('insforge_api_key');
  }

  setToken(token: string) {
    this.token = token;
    localStorage.setItem('insforge_token', token);
  }

  clearToken() {
    this.token = null;
    localStorage.removeItem('insforge_token');
  }

  getToken() {
    return this.token;
  }

  setApiKey(apiKey: string) {
    this.apiKey = apiKey;
    localStorage.setItem('insforge_api_key', apiKey);
  }

  getApiKey(): string | null {
    return this.apiKey;
  }

  setAuthErrorHandler(handler?: () => void) {
    this.onAuthError = handler;
  }

  async request(
    endpoint: string,
    options: RequestInit & {
      returnFullResponse?: boolean;
      skipAuth?: boolean;
      includeHeaders?: boolean;
    } = {}
  ) {
    const url = `${API_BASE}${endpoint}`;
    const { returnFullResponse, skipAuth, includeHeaders, ...fetchOptions } = options;

    // Initial request attempt
    const makeRequest = async () => {
      // Merge headers properly to preserve Content-Type when body is present
      const headers: Record<string, string> = {
        ...(!skipAuth && this.token && { Authorization: `Bearer ${this.token}` }),
        ...((fetchOptions.headers as Record<string, string>) || {}),
      };

      // Ensure Content-Type is set for JSON bodies
      if (fetchOptions.body && typeof fetchOptions.body === 'string') {
        headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      }

      const config: RequestInit = {
        ...fetchOptions,
        headers,
      };

      const response = await fetch(url, config);

      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
        } catch (e) {
          // If parsing JSON fails, throw a generic error
          const error: ApiError = new Error(`HTTP ${response.status}: ${response.statusText}`);
          error.response = { data: null, status: response.status };
          throw error;
        }

        // Handle authentication errors
        if (response.status === 401 && !skipAuth) {
          // Clear token and notify auth context
          this.clearToken();
          if (this.onAuthError) {
            this.onAuthError();
          }
        }

        // Handle traditional REST error format
        if (errorData.error && errorData.message) {
          const error: ApiError = new Error(errorData.message);
          error.response = {
            data: errorData,
            status: response.status,
          };
          throw error;
        }

        // Fallback for other error formats
        const error: ApiError = new Error(`HTTP ${response.status}: ${JSON.stringify(errorData)}`);
        error.response = {
          data: errorData,
          status: response.status,
        };
        throw error;
      }
      const text = await response.text();
      // compatible with empty response
      let responseData = null;
      try {
        responseData = text ? JSON.parse(text) : null;
      } catch (e) {
        responseData = text;
      }

      // If headers are requested, return response with headers
      if (includeHeaders) {
        const paginationHeaders: any = {};
        const totalCount = response.headers.get('X-Total-Count');
        const page = response.headers.get('X-Page');
        const totalPages = response.headers.get('X-Total-Pages');
        const limit = response.headers.get('X-Limit');
        const offset = response.headers.get('X-Offset');

        if (totalCount) {
          paginationHeaders.totalCount = parseInt(totalCount);
        }
        if (page) {
          paginationHeaders.page = parseInt(page);
        }
        if (totalPages) {
          paginationHeaders.totalPages = parseInt(totalPages);
        }
        if (limit) {
          paginationHeaders.limit = parseInt(limit);
        }
        if (offset) {
          paginationHeaders.offset = parseInt(offset);
        }

        return {
          data: responseData,
          pagination: Object.keys(paginationHeaders).length > 0 ? paginationHeaders : undefined,
        };
      }

      // If full response is requested, return it as-is
      if (returnFullResponse) {
        return responseData;
      }

      // Traditional REST format - return response directly
      return responseData;
    };

    return makeRequest();
  }

  // Helper method to add API key header
  withApiKey(headers: Record<string, string> = {}) {
    return this.apiKey ? { ...headers, 'x-api-key': this.apiKey } : headers;
  }
}

// Singleton instance
export const apiClient = new ApiClient();
