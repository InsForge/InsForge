import { apiClient } from '@/lib/api/client';
import type {
  UserSchema,
  CreateUserResponse,
  DeleteUsersResponse,
  UpdateUserAdminStatusResponse,
} from '@insforge/shared-schemas';

export type UserRoleFilter = 'users' | 'admins' | 'all';

export class UserService {
  /**
   * Get users list
   * @param queryParams - Query parameters for pagination
   * @param searchQuery - Optional search query
   * @returns Users list with total count
   */
  async getUsers(
    queryParams: string = '',
    searchQuery?: string,
    roleFilter: UserRoleFilter = 'users'
  ): Promise<{
    users: UserSchema[];
    pagination: { offset: number; limit: number; total: number };
  }> {
    let url = '/auth/users';
    const params = new URLSearchParams(queryParams);

    if (searchQuery && searchQuery.trim()) {
      params.set('search', searchQuery.trim());
    }

    params.set('roleFilter', roleFilter);

    if (params.toString()) {
      url += `?${params.toString()}`;
    }

    const response = await apiClient.request(url);

    return {
      users: response.data,
      pagination: response.pagination,
    };
  }

  async getUser(id: string): Promise<UserSchema> {
    return apiClient.request(`/auth/users/${id}`);
  }

  async register(email: string, password: string, name?: string): Promise<CreateUserResponse> {
    return apiClient.request('/auth/users', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
    });
  }

  async deleteUsers(userIds: string[]): Promise<DeleteUsersResponse> {
    return apiClient.request('/auth/users', {
      method: 'DELETE',
      body: JSON.stringify({ userIds }),
    });
  }

  async updateUserAdminStatus(
    userId: string,
    isProjectAdmin: boolean
  ): Promise<UpdateUserAdminStatusResponse> {
    return apiClient.request(`/auth/users/${userId}/admin`, {
      method: 'PATCH',
      body: JSON.stringify({ isProjectAdmin }),
    });
  }
}

export const userService = new UserService();
