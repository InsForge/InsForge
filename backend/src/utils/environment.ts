import { appConfig } from '@/infra/config/app.config.js';

/**
 * Environment utility functions for checking runtime environment
 */

/**
 * Check if the application is running in a cloud environment
 * Currently checks for AWS instance profile, but can be extended for other cloud providers
 */
export function isCloudEnvironment(): boolean {
  return !!(process.env.AWS_INSTANCE_PROFILE_NAME && process.env.AWS_INSTANCE_PROFILE_NAME.trim());
}

/**
 * The project this instance acts for on InsForge Cloud, or null when there is none.
 *
 * A project id alone does not mean cloud — PaaS templates set PROJECT_ID too — so this
 * is the only place the two facts are combined. Callers that need the id and callers
 * choosing between a cloud and a local provider ask the same question, so they ask it
 * the same way.
 */
export function cloudProjectId(): string | null {
  const projectId = appConfig.cloud?.projectId;
  if (!isCloudEnvironment() || !projectId || projectId === 'local') {
    return null;
  }
  return projectId;
}

/**
 * Get the API base URL from environment variable or default to localhost
 * @returns The API base URL
 */
export function getApiBaseUrl(): string {
  return process.env.API_BASE_URL || 'http://localhost:7130';
}

export function isDevelopment(): boolean {
  return process.env.NODE_ENV === 'development';
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}
