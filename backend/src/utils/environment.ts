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
 * Whether this deployment's control plane is InsForge's rather than the operator's.
 *
 * Two independent signals, because they answer different questions: the AWS instance
 * profile says "this is our infrastructure", and the PROJECT_ID + CLOUD_API_HOST pair
 * says "this project's control plane is elsewhere". A cloud-proxied project need not
 * run on an AWS instance profile, so a guard that protects tenant isolation has to
 * fail closed on either.
 *
 * Lives here so the compute driver's registration guard and the config endpoint's
 * write guard cannot drift apart — they are the same question.
 */
export function isCloudManagedProject(): boolean {
  const projectId = appConfig.cloud?.projectId;
  const cloudProject = !!projectId && projectId !== 'local' && !!appConfig.cloud?.apiHost;
  return isCloudEnvironment() || cloudProject;
}

/**
 * Check if the application can use shared OAuth keys
 * This is typically enabled in cloud environments to avoid storing secrets
 */
export function isOAuthSharedKeysAvailable(): boolean {
  return isCloudEnvironment();
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
