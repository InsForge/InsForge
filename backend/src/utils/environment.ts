/**
 * Environment utility functions for checking runtime environment
 */

/**
 * Whether this container has an AWS instance profile attached.
 *
 * Named for what it tests. It used to be called `isCloudEnvironment()` and was used as
 * the product's "am I cloud?" switch, which is how a tenant-isolation guard ended up
 * asking an AWS question — see `isCloudManagedProject()` below for that question.
 *
 * Keep this only where AWS access itself is the requirement: shipping logs to
 * CloudWatch needs credentials the profile provides, and nothing else about being a
 * cloud-managed project supplies them.
 */
export function hasAwsInstanceProfile(): boolean {
  return !!(process.env.AWS_INSTANCE_PROFILE_NAME && process.env.AWS_INSTANCE_PROFILE_NAME.trim());
}

/**
 * Whether this deployment is a cloud-managed project rather than someone's own install.
 *
 * Separate from `hasAwsInstanceProfile()` on purpose: that one answers "am I on our AWS
 * infrastructure", which only matters where AWS access itself is required. This one answers "is the control plane
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
 * OR'd with `hasAwsInstanceProfile()` so this is never less protective than the check
 * it replaces, and so it already holds for instances provisioned before this existed.
 */
export function isCloudManagedProject(): boolean {
  if (hasAwsInstanceProfile()) {
    return true;
  }
  const deploymentId = process.env.DEPLOYMENT_ID?.trim();
  const projectId = process.env.PROJECT_ID?.trim();
  return !!deploymentId && !!projectId && projectId !== 'local';
}

/**
 * Whether our own OAuth credentials may be used instead of the operator supplying
 * their own. Cloud provisioning writes them into the instance's environment, so this
 * is a question about the project, not about AWS.
 */
export function isOAuthSharedKeysAvailable(): boolean {
  return isCloudManagedProject();
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
