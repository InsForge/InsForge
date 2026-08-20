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

/**
 * Fail-closed check for development-only features: true only when NODE_ENV is
 * explicitly a recognized non-production environment. Unset, 'staging', or any
 * other value returns false.
 */
export function isDevelopmentOrTest(): boolean {
  return process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
}
