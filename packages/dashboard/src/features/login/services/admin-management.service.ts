import { apiClient } from '#lib/api/client';
import type { CreateAdminSchema, ChangeAdminPasswordSchema } from '@insforge/shared-schemas';

export interface AdminUser {
  username: string;
  createdAt: string;
  updatedAt: string;
}

export const adminService = {
  async changePassword(data: ChangeAdminPasswordSchema): Promise<{ message: string }> {
    const response = await apiClient.request('/auth/admin/change-password', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return response as { message: string };
  },

  async listAdmins(): Promise<{ admins: AdminUser[] }> {
    const response = await apiClient.request('/auth/admin', {
      method: 'GET',
    });
    return response as { admins: AdminUser[] };
  },

  async createAdmin(data: CreateAdminSchema): Promise<{ admin: AdminUser }> {
    const response = await apiClient.request('/auth/admin', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return response as { admin: AdminUser };
  },

  async deleteAdmin(username: string): Promise<void> {
    await apiClient.request(`/auth/admin/${username}`, {
      method: 'DELETE',
    });
  },
};
