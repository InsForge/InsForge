import { appConfig } from '@/infra/config/app.config.js';
import logger from '@/utils/logger.js';

/**
 * Startup guard against publicly known default secrets.
 *
 * The example env and compose files historically shipped placeholder values
 * (`dev-secret-please-change-in-production`,
 * `your-secret-key-here-must-be-32-char-or-above`). Because those strings are
 * committed to a public repository, any deployment that keeps one is trusting
 * a secret the whole world knows: anyone can mint a `project_admin` JWT with
 * it, and — since ENCRYPTION_KEY falls back to JWT_SECRET — decrypt every
 * secret in the store. Refusing to start is the only safe behavior; there is
 * no legitimate reason to run with one of these values.
 *
 * CI and throwaway local sandboxes can opt out explicitly with
 * INSFORGE_ALLOW_DEFAULT_SECRETS=1.
 */
const KNOWN_DEFAULT_JWT_SECRETS = new Set([
  'dev-secret-please-change-in-production',
  'your-secret-key-here-must-be-32-char-or-above',
]);

const KNOWN_DEFAULT_ADMIN_PASSWORDS = new Set(['change-this-password']);

const MIN_JWT_SECRET_LENGTH = 32;

function defaultsAllowed(): boolean {
  return process.env.INSFORGE_ALLOW_DEFAULT_SECRETS === '1';
}

export function assertNoDefaultSecrets(): void {
  const jwtSecret = appConfig.app.jwtSecret;

  if (jwtSecret && KNOWN_DEFAULT_JWT_SECRETS.has(jwtSecret)) {
    if (defaultsAllowed()) {
      logger.warn(
        'INSFORGE_ALLOW_DEFAULT_SECRETS=1 is set — running with a publicly known JWT_SECRET. ' +
          'Never do this on anything reachable by anyone else.'
      );
    } else {
      logger.error(
        'JWT_SECRET is set to a publicly known default value. Anyone can forge admin tokens ' +
          'and decrypt stored secrets with it. Generate a real secret and restart.'
      );
      throw new Error(
        'Refusing to start: JWT_SECRET is a publicly known default. Generate one with ' +
          '`openssl rand -hex 32`, set it in your environment (and rotate ENCRYPTION_KEY ' +
          'separately), then restart. To override for CI/sandboxes only: ' +
          'INSFORGE_ALLOW_DEFAULT_SECRETS=1'
      );
    }
  } else if (jwtSecret && jwtSecret.length < MIN_JWT_SECRET_LENGTH) {
    logger.warn(
      `JWT_SECRET is ${jwtSecret.length} characters; ${MIN_JWT_SECRET_LENGTH}+ recommended. ` +
        'Short secrets are easier to brute-force offline.'
    );
  }

  const adminPassword = appConfig.auth.rootAdminPassword;
  if (adminPassword && KNOWN_DEFAULT_ADMIN_PASSWORDS.has(adminPassword)) {
    logger.warn(
      'ROOT_ADMIN_PASSWORD is a publicly known default and the admin login endpoint is ' +
        'internet-reachable on exposed deployments. Set a strong, unique password.'
    );
  }
}
