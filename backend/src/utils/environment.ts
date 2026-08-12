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
 * Whether this deployment is a cloud-managed project rather than someone's own install.
 *
 * Separate from `isCloudEnvironment()` on purpose: that one answers "am I on our AWS
 * infrastructure" and gates OAuth shared keys. This one answers "is the control plane
 * ours", which is the question tenant-isolation guards need — a customer must not be
 * able to run containers on a host they do not own.
 *
 * The signal is DEPLOYMENT_ID **and** PROJECT_ID, because cloud provisioning writes
 * both on every instance (`config/user-data-scripts/default.sh` and `nodejs.sh`, from a
 * job whose `deploymentId` and `projectId` are required strings) while a self-host
 * install has no use for the pair:
 *
 *   - PROJECT_ID alone is deliberately not enough. `.env.example` ships it, every
 *     compose file passes it through, and `getProjectId()` documents it as the
 *     self-hosted way to scope compute services and function deployments. Reading it as
 *     "cloud" refused to register the Docker driver on a self-hoster's own machine, with
 *     nothing in the UI to explain why.
 *   - DEPLOYMENT_ID is read nowhere else in this codebase and does nothing for a
 *     self-host deployment. Requiring it alongside PROJECT_ID means a false positive
 *     takes two cloud-only variables set against the instructions next to them.
 *
 * OR'd with `isCloudEnvironment()` so this is never less protective than the check it
 * replaces, and so it already holds for instances provisioned before this existed.
 */
export function isCloudManagedProject(): boolean {
  if (isCloudEnvironment()) {
    return true;
  }
  const deploymentId = process.env.DEPLOYMENT_ID?.trim();
  const projectId = process.env.PROJECT_ID?.trim();
  return !!deploymentId && !!projectId && projectId !== 'local';
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
