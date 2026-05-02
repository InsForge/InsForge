import { apiClient } from '#lib/api/client';
import type {
  DeploymentSchema,
  CreateDeploymentResponse,
  CreateDirectDeploymentRequest,
  CreateDirectDeploymentResponse,
  UploadDeploymentFileResponse,
  StartDeploymentRequest,
  ListDeploymentsResponse,
  DeploymentEnvVar,
  DeploymentEnvVarWithValue,
  ListEnvVarsResponse,
  GetEnvVarResponse,
  UpsertEnvVarRequest,
  UpsertEnvVarsRequest,
  UpsertEnvVarsResponse,
  DeleteEnvVarResponse,
  UpdateSlugRequest,
  UpdateSlugResponse,
  DeploymentMetadataResponse,
  CustomDomain,
  AddCustomDomainRequest,
  ListCustomDomainsResponse,
  VerifyCustomDomainResponse,
} from '@insforge/shared-schemas';

export type {
  DeploymentSchema,
  CreateDeploymentResponse,
  CreateDirectDeploymentRequest,
  CreateDirectDeploymentResponse,
  UploadDeploymentFileResponse,
  ListDeploymentsResponse,
  DeploymentEnvVar,
  DeploymentEnvVarWithValue,
  ListEnvVarsResponse,
  GetEnvVarResponse,
  UpsertEnvVarRequest,
  UpsertEnvVarsRequest,
  UpsertEnvVarsResponse,
  DeleteEnvVarResponse,
  UpdateSlugRequest,
  UpdateSlugResponse,
  DeploymentMetadataResponse,
  CustomDomain,
  AddCustomDomainRequest,
  ListCustomDomainsResponse,
  VerifyCustomDomainResponse,
};

export class DeploymentsService {
  // ============================================================================
  // Deployments
  // ============================================================================

  /** Returns a paginated list of deployments for the project. */
  async listDeployments(limit = 50, offset = 0): Promise<ListDeploymentsResponse> {
    const searchParams = new URLSearchParams();
    searchParams.set('limit', String(limit));
    searchParams.set('offset', String(offset));

    const query = searchParams.toString();
    return apiClient.request(`/deployments?${query}`, {
      headers: apiClient.withAccessToken(),
    });
  }

  /** Returns a single deployment by its ID. */
  async getDeployment(id: string): Promise<DeploymentSchema> {
    return apiClient.request(`/deployments/${id}`, {
      headers: apiClient.withAccessToken(),
    });
  }

  /** Creates a new legacy deployment session with a pre-signed source zip upload URL. */
  async createDeployment(): Promise<CreateDeploymentResponse> {
    return apiClient.request('/deployments', {
      method: 'POST',
      headers: apiClient.withAccessToken(),
    });
  }

  /** Creates a new deployment session for direct file uploads. */
  async createDirectDeployment(
    data: CreateDirectDeploymentRequest
  ): Promise<CreateDirectDeploymentResponse> {
    return apiClient.request('/deployments/direct', {
      method: 'POST',
      headers: apiClient.withAccessToken(),
      body: JSON.stringify(data),
    });
  }

  /** Streams one registered deployment file through the backend to Vercel. */
  async uploadDeploymentFileContent(
    id: string,
    fileId: string,
    content: Blob | ArrayBuffer
  ): Promise<UploadDeploymentFileResponse> {
    return apiClient.request(`/deployments/${id}/files/${fileId}/content`, {
      method: 'PUT',
      headers: {
        ...apiClient.withAccessToken(),
        'Content-Type': 'application/octet-stream',
      },
      body: content,
    });
  }

  /** Triggers the Vercel deployment after source files are available. */
  async startDeployment(id: string, data?: StartDeploymentRequest): Promise<DeploymentSchema> {
    return apiClient.request(`/deployments/${id}/start`, {
      method: 'POST',
      headers: apiClient.withAccessToken(),
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  /** Polls Vercel and syncs the latest deployment state back to the database. */
  async syncDeployment(id: string): Promise<DeploymentSchema> {
    return apiClient.request(`/deployments/${id}/sync`, {
      method: 'POST',
      headers: apiClient.withAccessToken(),
    });
  }

  /** Cancels an in-progress deployment on Vercel. */
  async cancelDeployment(id: string): Promise<void> {
    return apiClient.request(`/deployments/${id}/cancel`, {
      method: 'POST',
      headers: apiClient.withAccessToken(),
    });
  }

  // ============================================================================
  // Environment Variables
  // ============================================================================

  /** Returns all environment variable keys (without values) for the Vercel project. */
  async listEnvVars(): Promise<DeploymentEnvVar[]> {
    const data = (await apiClient.request('/deployments/env-vars', {
      headers: apiClient.withAccessToken(),
    })) as ListEnvVarsResponse;
    return data.envVars;
  }

  /** Returns a single environment variable including its decrypted value. */
  async getEnvVar(id: string): Promise<DeploymentEnvVarWithValue> {
    const data = (await apiClient.request(`/deployments/env-vars/${encodeURIComponent(id)}`, {
      headers: apiClient.withAccessToken(),
    })) as GetEnvVarResponse;
    return data.envVar;
  }

  async upsertEnvVars(input: UpsertEnvVarsRequest): Promise<UpsertEnvVarsResponse> {
    return apiClient.request('/deployments/env-vars', {
      method: 'POST',
      headers: apiClient.withAccessToken(),
      body: JSON.stringify(input),
    });
  }

  /** Deletes an environment variable from the Vercel project by its Vercel ID. */
  async deleteEnvVar(id: string): Promise<DeleteEnvVarResponse> {
    return apiClient.request(`/deployments/env-vars/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: apiClient.withAccessToken(),
    });
  }

  // ============================================================================
  // Custom Slug/Domain
  // ============================================================================

  /** Updates the custom insforge.site slug (subdomain) for the deployment. */
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

  /** Returns deployment metadata including the current deployment ID and domain URLs. */
  async getMetadata(): Promise<DeploymentMetadataResponse> {
    return apiClient.request('/deployments/metadata', {
      headers: apiClient.withAccessToken(),
    });
  }

  // ============================================================================
  // Custom Domains (user-owned)
  // ============================================================================

  /** Returns all user-owned custom domains for the project. */
  async listCustomDomains(): Promise<CustomDomain[]> {
    const data = (await apiClient.request('/deployments/domains', {
      headers: apiClient.withAccessToken(),
    })) as ListCustomDomainsResponse;
    return data.domains;
  }

  /** Registers a user-owned domain on the Vercel project and persists it to the database. */
  async addCustomDomain(domain: string): Promise<CustomDomain> {
    const body: AddCustomDomainRequest = { domain };
    return apiClient.request('/deployments/domains', {
      method: 'POST',
      headers: apiClient.withAccessToken(),
      body: JSON.stringify(body),
    });
  }

  /** Triggers Vercel DNS verification for a domain and updates its status in the database. */
  async verifyCustomDomain(domain: string): Promise<VerifyCustomDomainResponse> {
    return apiClient.request(`/deployments/domains/${encodeURIComponent(domain)}/verify`, {
      method: 'POST',
      headers: apiClient.withAccessToken(),
    });
  }

  /** Removes a user-owned domain from both the Vercel project and the database. */
  async removeCustomDomain(domain: string): Promise<void> {
    return apiClient.request(`/deployments/domains/${encodeURIComponent(domain)}`, {
      method: 'DELETE',
      headers: apiClient.withAccessToken(),
    });
  }
}

export const deploymentsService = new DeploymentsService();
