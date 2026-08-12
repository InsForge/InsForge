/**
 * Environment utility functions for checking runtime environment
 */

/**
 * Whether this deployment is an InsForge-managed cloud project.
 *
 * The check is `AWS_INSTANCE_PROFILE_NAME`, which reads like an AWS question but is in
 * practice the only reliable "provisioned by us" marker, for four reasons worth writing
 * down because two attempts to replace it made things worse:
 *
 *   - Nothing sets it automatically. AWS does not inject it — the SDK reads instance
 *     credentials from IMDS and never needs the profile's *name* — so it appears only
 *     because our provisioning writes it (`AWS_INSTANCE_PROFILE_NAME=EC2-role` in
 *     cloud-backend's `config/user-data-scripts/default.sh`).
 *   - No self-host artefact mentions it: not `.env.example`, not any compose file, not
 *     `deploy/zeabur/template.yml`, not the docs. Keep it that way — `.env.example` is
 *     copied and filled in, so listing a variable there is what turns it into one an
 *     operator sets by accident.
 *   - Its value is read nowhere (`appConfig.cloud.instanceProfile` is unused), so a
 *     self-hoster gains nothing by setting it even if they find it.
 *   - Every provisioned cloud instance already has it, so it needs no rollout.
 *
 * Rejected alternatives, both of which misclassified real self-hosts:
 *
 *   - `PROJECT_ID`: `.env.example` ships it, every compose file passes it through, and
 *     the compute routes document it as the self-hosted way to scope services.
 *   - `DEPLOYMENT_ID` + `PROJECT_ID`: `deploy/zeabur/template.yml` fills both from
 *     `${ZEABUR_SERVICE_ID}` and `${ZEABUR_PROJECT_ID}`, so every Zeabur install looks
 *     like one of ours.
 *
 * Anything deciding "is this ours" — tenant isolation, managed credentials, which
 * provider serves a feature — should call this rather than inspecting ids itself.
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
