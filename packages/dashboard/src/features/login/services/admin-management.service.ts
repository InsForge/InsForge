import { apiClient } from '#lib/api/client';

export interface AdminUser {
  username: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChangePasswordRequest {
  oldPassword: string;
  newPassword: string;
}

export const adminService = {
  async changePassword(data: ChangePasswordRequest): Promise<{ message: string }> {
    const response = await apiClient.request('/auth/admin/change-password', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return response as { message: string };
  },
};
