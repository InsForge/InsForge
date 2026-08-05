import axios from 'axios';
import logger from '@/utils/logger.js';
import { z } from 'zod';

export interface GitHubRepositoryMetadata {
  stars: number | null;
}

const CACHE_TTL_MS = 30 * 60 * 1000;

const gitHubRepositorySchema = z.object({
  stargazers_count: z.number().int().nonnegative(),
});

export class GitHubService {
  private static instance: GitHubService;

  private cachedMetadata: GitHubRepositoryMetadata | null = null;

  private cacheExpiresAt = 0;

  /** In-flight fetch promise shared by all concurrent callers. */
  private inflightRequest: Promise<GitHubRepositoryMetadata> | null = null;

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

    // Coalesce concurrent callers onto a single in-flight request so we never
    // fire more than one GitHub API call at a time while the cache is empty or
    // expired (prevents cache-refresh stampede / rate-limit exhaustion).
    if (this.inflightRequest) {
      return this.inflightRequest;
    }

    this.inflightRequest = this.fetchAndCache().finally(() => {
      this.inflightRequest = null;
    });

    return this.inflightRequest;
  }

  private async fetchAndCache(): Promise<GitHubRepositoryMetadata> {
    try {
      const response = await axios.get('https://api.github.com/repos/InsForge/InsForge', {
        timeout: 5000,
        headers: {
          Accept: 'application/vnd.github+json',
        },
      });

      const parsed = gitHubRepositorySchema.safeParse(response.data);

      if (!parsed.success) {
        logger.warn('GitHub repository response validation failed', {
          error: parsed.error.flatten(),
        });
      }

      const metadata: GitHubRepositoryMetadata = {
        stars: parsed.success ? parsed.data.stargazers_count : null,
      };

      this.cachedMetadata = metadata;
      this.cacheExpiresAt = Date.now() + CACHE_TTL_MS;

      return metadata;
    } catch (error) {
      logger.warn('Failed to fetch GitHub repository metadata', {
        error: error instanceof Error ? error.message : String(error),
      });

      const metadata: GitHubRepositoryMetadata = {
        stars: null,
      };

      this.cachedMetadata = metadata;
      this.cacheExpiresAt = Date.now() + CACHE_TTL_MS;

      return metadata;
    }
  }
}
