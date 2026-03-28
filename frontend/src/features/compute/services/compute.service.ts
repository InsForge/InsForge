import { apiClient } from '@/lib/api/client';
import type {
  ContainerSchema,
  ContainerDeploymentSchema,
  CreateContainerRequest,
  UpdateContainerRequest,
  DeployContainerRequest,
  RollbackContainerRequest,
} from '@insforge/shared-schemas';

interface ListContainersResponse {
  containers: ContainerSchema[];
}

interface ListDeploymentsResponse {
  deployments: ContainerDeploymentSchema[];
}

interface LogStream {
  events: { timestamp: number; message: string }[];
  nextToken?: string;
}

class ComputeApiService {
  async listContainers(): Promise<ContainerSchema[]> {
    const response: ListContainersResponse = await apiClient.request('/compute/containers', {
      headers: apiClient.withAccessToken(),
    });
    return response.containers ?? [];
  }

  async getContainer(id: string): Promise<ContainerSchema> {
    return apiClient.request(`/compute/containers/${id}`, {
      headers: apiClient.withAccessToken(),
    });
  }

  async createContainer(data: CreateContainerRequest): Promise<ContainerSchema> {
    return apiClient.request('/compute/containers', {
      method: 'POST',
      headers: apiClient.withAccessToken(),
      body: JSON.stringify(data),
    });
  }

  async updateContainer(id: string, data: UpdateContainerRequest): Promise<ContainerSchema> {
    return apiClient.request(`/compute/containers/${id}`, {
      method: 'PATCH',
      headers: apiClient.withAccessToken(),
      body: JSON.stringify(data),
    });
  }

  async deleteContainer(id: string): Promise<void> {
    return apiClient.request(`/compute/containers/${id}`, {
      method: 'DELETE',
      headers: apiClient.withAccessToken(),
    });
  }

  async deploy(
    containerId: string,
    data?: DeployContainerRequest
  ): Promise<ContainerDeploymentSchema> {
    return apiClient.request(`/compute/containers/${containerId}/deploy`, {
      method: 'POST',
      headers: apiClient.withAccessToken(),
      body: JSON.stringify(data ?? { triggeredBy: 'manual' }),
    });
  }

  async rollback(
    containerId: string,
    data: RollbackContainerRequest
  ): Promise<ContainerDeploymentSchema> {
    return apiClient.request(`/compute/containers/${containerId}/rollback`, {
      method: 'POST',
      headers: apiClient.withAccessToken(),
      body: JSON.stringify(data),
    });
  }

  async listDeployments(containerId: string): Promise<ContainerDeploymentSchema[]> {
    const response: ListDeploymentsResponse = await apiClient.request(
      `/compute/containers/${containerId}/deployments`,
      { headers: apiClient.withAccessToken() }
    );
    return response.deployments ?? [];
  }

  async getLogs(containerId: string): Promise<LogStream> {
    return apiClient.request(`/compute/containers/${containerId}/logs`, {
      headers: apiClient.withAccessToken(),
    });
  }
}

export const computeService = new ComputeApiService();
