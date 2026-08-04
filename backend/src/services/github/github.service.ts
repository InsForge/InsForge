import axios from 'axios';
import logger from '@/utils/logger.js';

export interface GitHubRepositoryMetadata {
  stars: number | null;
}

const CACHE_TTL_MS = 30 * 60 * 1000;

export class GitHubService {
  private static instance: GitHubService;

  private cachedMetadata: GitHubRepositoryMetadata | null = null;

  private cacheExpiresAt = 0;

  private constructor() {}

  public static getInstance(): GitHubService {
    if (!GitHubService.instance) {
      GitHubService.instance = new GitHubService();
    }
    return GitHubService.instance;
  }

  async getRepositoryMetadata(): Promise<GitHubRepositoryMetadata> {
    if (this.cachedMetadata && Date.now() < this.cacheExpiresAt) {
      return this.cachedMetadata;
    }

    try {
      const response = await axios.get(
  'https://api.github.com/repos/InsForge/InsForge',
  {
    timeout: 5000,
    headers: {
      Accept: 'application/vnd.github+json',
    },
  }
);

      const metadata: GitHubRepositoryMetadata = {
        stars: response.data.stargazers_count ?? null,
      };

      this.cachedMetadata = metadata;
      this.cacheExpiresAt = Date.now() + CACHE_TTL_MS;

      return metadata;
    } catch (error) {
      logger.warn('Failed to fetch GitHub repository metadata', {
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        stars: null,
      };
    }
  }
}