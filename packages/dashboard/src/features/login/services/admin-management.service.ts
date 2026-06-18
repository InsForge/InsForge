import { apiClient } from '#lib/api/client';
import type { ChangeAdminPasswordSchema } from '@insforge/shared-schemas';

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
};
