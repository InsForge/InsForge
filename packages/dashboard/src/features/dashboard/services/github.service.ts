import { apiClient } from '#lib/api/client';

export interface GitHubRepositoryMetadata {
  stars: number | null;
}

export class GitHubService {
  async getRepositoryMetadata(): Promise<GitHubRepositoryMetadata> {
    return apiClient.request('/github/repository', {
      method: 'GET',
      headers: apiClient.withAccessToken(),
    });
  }
}

export const githubService = new GitHubService();
