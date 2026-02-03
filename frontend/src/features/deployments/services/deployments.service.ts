import { apiClient } from '@/lib/api/client';
import type {
  DeploymentSchema,
  CreateDeploymentResponse,
  StartDeploymentRequest,
  ListDeploymentsResponse,
  DeploymentEnvVar,
  DeploymentEnvVarWithValue,
  ListEnvVarsResponse,
  GetEnvVarResponse,
  UpsertEnvVarRequest,
  UpsertEnvVarResponse,
  DeleteEnvVarResponse,
  UpdateSlugRequest,
  UpdateSlugResponse,
  DeploymentMetadataResponse,
} from '@insforge/shared-schemas';

export type {
  DeploymentSchema,
  CreateDeploymentResponse,
  ListDeploymentsResponse,
  DeploymentEnvVar,
  DeploymentEnvVarWithValue,
  ListEnvVarsResponse,
  GetEnvVarResponse,
  UpsertEnvVarRequest,
  UpsertEnvVarResponse,
  DeleteEnvVarResponse,
  UpdateSlugRequest,
  UpdateSlugResponse,
  DeploymentMetadataResponse,
};

export class DeploymentsService {
  // ============================================================================
  // Deployments
  // ============================================================================

  async listDeployments(limit = 50, offset = 0): Promise<ListDeploymentsResponse> {
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

  // ============================================================================
  // Environment Variables
  // ============================================================================

  async listEnvVars(): Promise<DeploymentEnvVar[]> {
    const data = (await apiClient.request('/deployments/env-vars', {
      headers: apiClient.withAccessToken(),
    })) as ListEnvVarsResponse;
    return data.envVars;
  }

  async getEnvVar(id: string): Promise<DeploymentEnvVarWithValue> {
    const data = (await apiClient.request(`/deployments/env-vars/${encodeURIComponent(id)}`, {
      headers: apiClient.withAccessToken(),
    })) as GetEnvVarResponse;
    return data.envVar;
  }

  async upsertEnvVar(input: UpsertEnvVarRequest): Promise<UpsertEnvVarResponse> {
    return apiClient.request('/deployments/env-vars', {
      method: 'POST',
      headers: apiClient.withAccessToken(),
      body: JSON.stringify(input),
    });
  }

  async deleteEnvVar(id: string): Promise<DeleteEnvVarResponse> {
    return apiClient.request(`/deployments/env-vars/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: apiClient.withAccessToken(),
    });
  }

  // ============================================================================
  // Custom Slug/Domain
  // ============================================================================

  async updateSlug(slug: string | null): Promise<UpdateSlugResponse> {
    return apiClient.request('/deployments/slug', {
      method: 'PUT',
      headers: apiClient.withAccessToken(),
      body: JSON.stringify({ slug }),
    });
  }

  // ============================================================================
  // Metadata
  // ============================================================================

  async getMetadata(): Promise<DeploymentMetadataResponse> {
    return apiClient.request('/deployments/metadata', {
      headers: apiClient.withAccessToken(),
    });
  }
}

export const deploymentsService = new DeploymentsService();
