const API_BASE = '/api';

interface ApiError extends Error {
  response?: {
    data: unknown;
    status: number;
  };
}

export class ApiClient {
  private token: string | null = null;
  private onAuthError?: () => void;

  constructor() {
    this.token = localStorage.getItem('insforge_token');
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

  setAuthErrorHandler(handler?: () => void) {
    this.onAuthError = handler;
  }

  request(
    endpoint: string,
    options: RequestInit & {
      returnFullResponse?: boolean;
      skipAuth?: boolean;
    } = {}
  ) {
    const url = `${API_BASE}${endpoint}`;
    const { returnFullResponse, skipAuth, ...fetchOptions } = options;

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
        } catch {
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

        // For CSV validation errors (400 with rowErrors), throw the entire error object
        // This allows the component to detect and display validation errors properly
        if (response.status === 400 && errorData.rowErrors) {
          throw errorData;
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
      } catch {
        responseData = text;
      }

      // Check for Content-Range header and extract pagination if present
      const contentRange = response.headers.get('content-range');
      if (contentRange && Array.isArray(responseData)) {
        const match = contentRange.match(/(\d+)-(\d+)\/(\d+|\*)/);
        if (match) {
          const start = parseInt(match[1]);
          const end = parseInt(match[2]);
          const total = match[3] === '*' ? responseData.length : parseInt(match[3]);

          const pagination = {
            offset: start,
            limit: end - start + 1,
            total,
          };

          return {
            data: responseData,
            pagination,
          };
        } else {
          return {
            data: responseData,
            pagination: {
              offset: 0,
              limit: 0,
              total: 0,
            },
          };
        }
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

  // Helper method to add authorization header with token
  withAccessToken(headers: Record<string, string> = {}) {
    return this.token ? { ...headers, Authorization: `Bearer ${this.token}` } : headers;
  }
}

// Singleton instance
export const apiClient = new ApiClient();
