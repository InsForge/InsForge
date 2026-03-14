import { apiClient } from '@/lib/api/client';
import {
  SecretSchema,
  CreateSecretRequest,
  CreateSecretResponse,
  ListSecretsResponse,
  DeleteSecretResponse,
} from '@insforge/shared-schemas';

export class SecretService {
  async listSecrets(): Promise<SecretSchema[]> {
    const data = (await apiClient.request('/secrets', {
      headers: apiClient.withAccessToken(),
    })) as ListSecretsResponse;
    return data.secrets as SecretSchema[];
  }

  async getSecret(key: string): Promise<{ key: string; value: string }> {
    const response = await apiClient.request(`/secrets/${encodeURIComponent(key)}`, {
      method: 'GET',
      headers: apiClient.withAccessToken(),
    });
    return response as { key: string; value: string };
  }

  async createSecret(input: CreateSecretRequest): Promise<CreateSecretResponse> {
    const response: CreateSecretResponse = await apiClient.request('/secrets', {
      method: 'POST',
      headers: apiClient.withAccessToken(),
      body: JSON.stringify(input),
    });
    return response;
  }

  async deleteSecret(key: string): Promise<DeleteSecretResponse> {
    const response: DeleteSecretResponse = await apiClient.request(
      `/secrets/${encodeURIComponent(key)}`,
      {
        method: 'DELETE',
        headers: apiClient.withAccessToken(),
      }
    );
    return response;
  }
}

export const secretService = new SecretService();
