import { apiClient } from '@/lib/api/client';

// Check if Better Auth is enabled via environment variable
const ENABLE_BETTER_AUTH = import.meta.env.VITE_ENABLE_BETTER_AUTH === 'true';

export interface User {
  id: string;
  email: string;
  name?: string;
  createdAt: string;
  updatedAt: string;
  role?: string;
}

export class AuthService {
  async login(email: string, password: string) {
    const endpoint = ENABLE_BETTER_AUTH ? '/auth/v2/admin/sign-in' : '/auth/admin/login';

    const data = await apiClient.request(endpoint, {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    // Set token in apiClient
    const token = ENABLE_BETTER_AUTH ? data.token : data.accessToken;
    if (token) {
      apiClient.setToken(token);
    }

    // Return unified format for Better Auth, pass through for legacy
    if (ENABLE_BETTER_AUTH) {
      return {
        accessToken: data.token,
        user: {
          ...data.user,
          createdAt: data.user.createdAt || data.user.createdAt,
          updatedAt: data.user.updatedAt || data.user.updatedAt,
        },
      };
    }

    return data;
  }

  async getCurrentUser() {
    // Both Better Auth and legacy use /me endpoint
    const endpoint = ENABLE_BETTER_AUTH ? '/auth/v2/me' : '/auth/me';
    const response = await apiClient.request(endpoint);
    return response.user;
  }

  logout() {
    apiClient.clearToken();
  }

  // User management
  async getUsers(queryParams: string = '', searchQuery?: string) {
    // Build URL based on auth type
    let url = ENABLE_BETTER_AUTH ? '/auth/v2/admin/users' : '/auth/users';
    const params = new URLSearchParams(queryParams);

    if (searchQuery && searchQuery.trim()) {
      params.set('search', searchQuery.trim());
    }

    if (params.toString()) {
      url += `?${params.toString()}`;
    }

    const data = await apiClient.request(url);

    // Both auth types return the same format
    return {
      records: data?.users || [],
      total: data?.total || 0,
    };
  }

  async getUser(id: string) {
    if (ENABLE_BETTER_AUTH) {
      // Better Auth now supports fetching individual users
      return await apiClient.request(`/auth/v2/admin/users/${id}`);
    } else {
      // Legacy auth doesn't support individual user fetching
      // Need to fetch all users and filter
      const allUsers = await this.getUsers();
      const user = allUsers.records.find((u: User) => u.id === id);
      if (!user) {
        throw new Error('User not found');
      }
      return user;
    }
  }

  async register(email: string, password: string, name?: string, id?: string) {
    const endpoint = ENABLE_BETTER_AUTH ? '/auth/v2/sign-up/email' : '/auth/register';
    const body = ENABLE_BETTER_AUTH ? { email, password, name } : { email, password, name, id };

    return apiClient.request(endpoint, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async bulkDeleteUsers(userIds: string[]) {
    const endpoint = ENABLE_BETTER_AUTH
      ? '/auth/v2/admin/users/bulk-delete'
      : '/auth/users/bulk-delete';

    return apiClient.request(endpoint, {
      method: 'DELETE',
      body: JSON.stringify({ userIds }),
    });
  }
}

// These operations are not implemented in the backend yet
// The backend would need to add:
// PATCH /api/auth/users/:id for updating user email
//  DELETE /api/auth/users/:id for deleting users
// Profile updates go through /api/profile/me or /api/profile/:id

export const authService = new AuthService();
