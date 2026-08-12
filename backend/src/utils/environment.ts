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
 * Implemented over `hasAwsInstanceProfile()` and kept as its own function on purpose:
 * this is the question every tenant-isolation and product-mode decision should ask, and
 * having one place to ask it means a better marker can be introduced later by changing
 * this body alone.
 *
 * Why that variable is the signal, despite the AWS-sounding name:
 *
 *   - Nothing sets it automatically. AWS does not inject it — the SDK reads instance
 *     credentials from IMDS and never needs the profile's *name* — so it appears only
 *     because our provisioning writes it (`AWS_INSTANCE_PROFILE_NAME=EC2-role` in
 *     `config/user-data-scripts/default.sh`).
 *   - No self-host artefact mentions it: not `.env.example`, not any compose file, not
 *     `deploy/zeabur/template.yml`, not the docs. It is deliberately kept out of
 *     `.env.example` — that file is copied and filled in, so listing a variable there is
 *     what turns it into something an operator sets by accident.
 *   - Its value is never read. Only presence matters, so setting it buys a self-hoster
 *     nothing even if they found it.
 *   - Every already-provisioned cloud instance has it, so no rollout or re-provisioning
 *     is needed.
 *
 * What was tried and rejected: PROJECT_ID, alone or paired with DEPLOYMENT_ID.
 * `.env.example` ships both, every compose file passes them through, `getProjectId()`
 * documents PROJECT_ID as the self-hosted way to scope services, and
 * `deploy/zeabur/template.yml` fills both from platform variables — so a third-party
 * self-host looks identical to one of ours.
 */
export function isCloudManagedProject(): boolean {
  return hasAwsInstanceProfile();
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
