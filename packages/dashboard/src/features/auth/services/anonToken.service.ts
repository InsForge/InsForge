import { apiClient } from '#lib/api/client';

export class AnonTokenService {
  async generateAnonToken(): Promise<{ accessToken: string; message: string }> {
    return apiClient.request('/auth/tokens/anon', {
      method: 'POST',
    });
  }
}

export const anonTokenService = new AnonTokenService();
