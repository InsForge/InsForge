import jwt from 'jsonwebtoken';
import { appConfig } from '@/infra/config/app.config.js';
import { cloudProjectId, isCloudEnvironment } from '@/utils/environment.js';
import { AppError } from '@/utils/errors.js';
import { ERROR_CODES } from '@insforge/shared-schemas';

type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * Sign the short-lived `sign` header every cloud-backend call carries.
 *
 * The cloud backend authenticates the caller as a project: `sub` is the project id and
 * the signature proves the caller holds that project's JWT_SECRET. Off our infrastructure
 * there is no such relationship, so this refuses rather than signing a token that would
 * be rejected remotely with nothing an operator can act on.
 *
 * @param feature Subject of the off-cloud message, e.g. 'Cloud database access'.
 */
export function signCloudToken(
  feature: string,
  errorCode: ErrorCode = ERROR_CODES.INTERNAL_ERROR
): string {
  if (!isCloudEnvironment()) {
    throw new AppError(`${feature} is only available on InsForge Cloud projects.`, 500, errorCode);
  }

  const projectId = cloudProjectId();
  if (!projectId) {
    throw new AppError(
      'PROJECT_ID is not configured. Cannot reach the InsForge Cloud API.',
      500,
      errorCode
    );
  }

  const jwtSecret = appConfig.app.jwtSecret;
  if (!jwtSecret) {
    throw new AppError('JWT_SECRET is not configured. Cannot generate sign token.', 500, errorCode);
  }

  return jwt.sign({ sub: projectId }, jwtSecret, { expiresIn: '10m' });
}
