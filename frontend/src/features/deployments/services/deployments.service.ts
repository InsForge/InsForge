import { apiClient } from '@/lib/api/client';
import type {
  DeploymentSchema,
  CreateDeploymentResponse,
  StartDeploymentRequest,
} from '@insforge/shared-schemas';

export type { DeploymentSchema, CreateDeploymentResponse };

export class DeploymentsService {
  // ============================================================================
  // Deployments
  // ============================================================================

  async listDeployments(limit = 50, offset = 0): Promise<DeploymentSchema[]> {
    const searchParams = new URLSearchParams();
    searchParams.set('limit', String(limit));
    searchParams.set('offset', String(offset));

    const query = searchParams.toString();
    return apiClient.request(`/deployments?${query}`, {
      headers: apiClient.withAccessToken(),
    });
  }

  async getDeployment(id: string): Promise<DeploymentSchema> {
    return apiClient.request(`/deployments/${id}`, {
      headers: apiClient.withAccessToken(),
    });
  }

  async createDeployment(): Promise<CreateDeploymentResponse> {
    return apiClient.request('/deployments', {
      method: 'POST',
      headers: apiClient.withAccessToken(),
    });
  }

  async startDeployment(id: string, data?: StartDeploymentRequest): Promise<DeploymentSchema> {
    return apiClient.request(`/deployments/${id}/start`, {
      method: 'POST',
      headers: apiClient.withAccessToken(),
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async syncDeployment(id: string): Promise<DeploymentSchema> {
    return apiClient.request(`/deployments/${id}/sync`, {
      method: 'POST',
      headers: apiClient.withAccessToken(),
    });
  }

  async cancelDeployment(id: string): Promise<void> {
    return apiClient.request(`/deployments/${id}/cancel`, {
      method: 'POST',
      headers: apiClient.withAccessToken(),
    });
  }
}

export const deploymentsService = new DeploymentsService();
