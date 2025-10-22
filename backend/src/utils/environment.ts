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
 * Check if the application can use shared OAuth keys
 * This is typically enabled in cloud environments to avoid storing secrets
 */
export function isOAuthSharedKeysAvailable(): boolean {
  return isCloudEnvironment();
}

/**
 * Check if running in development mode
 */
export function isDevelopment(): boolean {
  return process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
}

/**
 * Check if running in production mode
 */
export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Get the API base URL from environment variable or default to localhost
 * @returns The API base URL
 */
export function getApiBaseUrl(): string {
  return process.env.API_BASE_URL || 'http://localhost:7130';
}

/**
 * Get deployment backend type based on environment
 * @returns 's3' for cloud with S3, 'local' for self-hosted
 */
export function getDeploymentBackend(): 's3' | 'local' {
  // If AWS S3 bucket is configured, use S3 backend
  if (process.env.AWS_S3_BUCKET && process.env.AWS_S3_BUCKET.trim()) {
    return 's3';
  }
  // Default to local filesystem
  return 'local';
}

/**
 * Get deployment base URL
 * @returns Base URL for deployments
 */
export function getDeploymentBaseUrl(): string {
  const backend = getDeploymentBackend();

  if (backend === 's3' && process.env.AWS_CLOUDFRONT_URL) {
    return `${process.env.AWS_CLOUDFRONT_URL}/deployments`;
  }

  // Local deployment URL
  return process.env.DEPLOYMENT_BASE_URL || 'http://localhost:8080/deployments';
}
