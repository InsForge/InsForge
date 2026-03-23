import { apiClient } from '@/lib/api/client';
import {
  ContainerSchema,
  ContainerDeploymentSchema,
  CreateContainerRequest,
  UpdateContainerRequest,
} from '@insforge/shared-schemas';

export interface ListContainersResponse {
  containers: ContainerSchema[];
}

export interface ListDeploymentsResponse {
  deployments: ContainerDeploymentSchema[];
}

export interface GetLogsResponse {
  logs: string[];
  containerId: string;
}

export class ComputeService {
  async listContainers(projectId?: string): Promise<ListContainersResponse> {
    const query = projectId ? `?project_id=${projectId}` : '';
    const response: ListContainersResponse = await apiClient.request(
      `/compute/containers${query}`,
      {
        headers: apiClient.withAccessToken(),
      }
    );
    return {
      containers: Array.isArray(response.containers) ? response.containers : [],
    };
  }

  async getContainer(id: string): Promise<ContainerSchema> {
    const response: ContainerSchema = await apiClient.request(`/compute/containers/${id}`, {
      headers: apiClient.withAccessToken(),
    });
    return response;
  }

  async createContainer(data: CreateContainerRequest): Promise<ContainerSchema> {
    const response: ContainerSchema = await apiClient.request('/compute/containers', {
      method: 'POST',
      headers: apiClient.withAccessToken(),
      body: JSON.stringify(data),
    });
    return response;
  }

  async updateContainer(id: string, data: UpdateContainerRequest): Promise<ContainerSchema> {
    const response: ContainerSchema = await apiClient.request(`/compute/containers/${id}`, {
      method: 'PATCH',
      headers: apiClient.withAccessToken(),
      body: JSON.stringify(data),
    });
    return response;
  }

  async deleteContainer(id: string): Promise<void> {
    return apiClient.request(`/compute/containers/${id}`, {
      method: 'DELETE',
      headers: apiClient.withAccessToken(),
    });
  }

  async deploy(containerId: string): Promise<ContainerDeploymentSchema> {
    const response: ContainerDeploymentSchema = await apiClient.request(
      `/compute/containers/${containerId}/deploy`,
      {
        method: 'POST',
        headers: apiClient.withAccessToken(),
        body: JSON.stringify({ triggered_by: 'manual' }),
      }
    );
    return response;
  }

  async listDeployments(containerId: string): Promise<ListDeploymentsResponse> {
    const response: ListDeploymentsResponse = await apiClient.request(
      `/compute/containers/${containerId}/deployments`,
      {
        headers: apiClient.withAccessToken(),
      }
    );
    return {
      deployments: Array.isArray(response.deployments) ? response.deployments : [],
    };
  }

  async rollback(containerId: string, deploymentId: string): Promise<ContainerDeploymentSchema> {
    const response: ContainerDeploymentSchema = await apiClient.request(
      `/compute/containers/${containerId}/rollback/${deploymentId}`,
      {
        method: 'POST',
        headers: apiClient.withAccessToken(),
      }
    );
    return response;
  }

  async getLogs(containerId: string, limit?: number): Promise<GetLogsResponse> {
    const query = limit ? `?limit=${limit}` : '';
    const response: GetLogsResponse = await apiClient.request(
      `/compute/containers/${containerId}/logs${query}`,
      {
        headers: apiClient.withAccessToken(),
      }
    );
    return response;
  }
}

export const computeService = new ComputeService();
