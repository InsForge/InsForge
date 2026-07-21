import type { PoolClient } from 'pg';
import { appConfig } from '@/infra/config/app.config.js';
import { EncryptionManager } from '@/infra/security/encryption.manager.js';
import { AppError } from '@/utils/errors.js';
import { NEXT_ACTIONS } from '@/utils/next-actions.js';
import logger from '@/utils/logger.js';
import { ERROR_CODES } from '@insforge/shared-schemas';

const EMAIL_PROVIDER_CONFIGURATION_LOCK_ID = 1869573991;

export function hasManagedEmailProvider(): boolean {
  const projectId = appConfig.cloud.projectId;
  return Boolean(projectId && projectId !== 'local' && appConfig.app.jwtSecret);
}

export async function lockEmailProviderConfiguration(client: PoolClient): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock($1)', [EMAIL_PROVIDER_CONFIGURATION_LOCK_ID]);
}

export async function hasAvailableEmailProvider(client: PoolClient): Promise<boolean> {
  if (hasManagedEmailProvider()) {
    return true;
  }

  const result = await client.query('SELECT enabled, password_encrypted FROM email.config LIMIT 1');
  const smtpConfig = result.rows[0];
  if (!smtpConfig?.enabled || !smtpConfig.password_encrypted) {
    return false;
  }

  try {
    return Boolean(EncryptionManager.decrypt(smtpConfig.password_encrypted));
  } catch (error) {
    logger.error('SMTP credentials are unavailable while checking the email provider', { error });
    return false;
  }
}

export function emailProviderNotConfiguredError(): AppError {
  return new AppError(
    'An email provider must be configured before email verification can be required.',
    400,
    ERROR_CODES.EMAIL_PROVIDER_NOT_CONFIGURED,
    NEXT_ACTIONS.CONFIGURE_EMAIL_PROVIDER
  );
}
