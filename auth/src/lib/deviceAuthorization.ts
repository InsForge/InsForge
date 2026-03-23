import {
  deviceAuthorizationClientContextSchema,
  deviceAuthorizationStatusSchema,
} from '@insforge/shared-schemas';
import { z } from 'zod';
import { getBackendUrl } from './utils';

export const AUTH_SIGN_IN_PATH = '/auth/sign-in';
export const AUTH_SIGN_UP_PATH = '/auth/sign-up';
export const AUTH_VERIFY_EMAIL_PATH = '/auth/verify-email';
export const AUTH_FORGOT_PASSWORD_PATH = '/auth/forgot-password';
export const AUTH_RESET_PASSWORD_PATH = '/auth/reset-password';
export const AUTH_DEVICE_AUTHORIZE_PATH = '/auth/device';
export const AUTH_DEVICE_CONSENT_PATH = '/auth/device/consent';

const DEVICE_AUTHORIZATION_BASE_PATH = '/api/auth/device';
const DEVICE_AUTHORIZATION_LOOKUP_PATH = `${DEVICE_AUTHORIZATION_BASE_PATH}/authorizations/lookup`;
const DEVICE_AUTHORIZATION_APPROVE_PATH = `${DEVICE_AUTHORIZATION_BASE_PATH}/authorizations/approve`;
const DEVICE_AUTHORIZATION_DENY_PATH = `${DEVICE_AUTHORIZATION_BASE_PATH}/authorizations/deny`;

export const deviceAuthorizationSessionViewSchema = z.object({
  status: deviceAuthorizationStatusSchema,
  expiresAt: z.string(),
  clientContext: deviceAuthorizationClientContextSchema.nullable().optional(),
});

export type DeviceAuthorizationSessionView = z.infer<typeof deviceAuthorizationSessionViewSchema>;

export function normalizeUserCodeInput(value: string): string {
  const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, '');

  if (cleaned.length === 8) {
    return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`;
  }

  return value.toUpperCase().trim();
}

export function buildDeviceConsentPath(userCode: string): string {
  return `${AUTH_DEVICE_CONSENT_PATH}?user_code=${encodeURIComponent(normalizeUserCodeInput(userCode))}`;
}

export function buildDeviceSignInPath(userCode: string): string {
  return `${AUTH_SIGN_IN_PATH}?redirect=${encodeURIComponent(buildDeviceConsentPath(userCode))}`;
}

async function postDeviceAuthorizationSession(
  path: string,
  userCode: string,
  accessToken?: string
): Promise<DeviceAuthorizationSessionView> {
  const response = await fetch(`${getBackendUrl()}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({
      userCode: normalizeUserCodeInput(userCode),
    }),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      payload &&
      typeof payload === 'object' &&
      'message' in payload &&
      typeof payload.message === 'string'
        ? payload.message
        : 'Device authorization request failed';
    throw new Error(message);
  }

  return deviceAuthorizationSessionViewSchema.parse(payload);
}

export function lookupDeviceAuthorization(
  userCode: string
): Promise<DeviceAuthorizationSessionView> {
  return postDeviceAuthorizationSession(DEVICE_AUTHORIZATION_LOOKUP_PATH, userCode);
}

export function approveDeviceAuthorization(
  userCode: string,
  accessToken: string
): Promise<DeviceAuthorizationSessionView> {
  return postDeviceAuthorizationSession(DEVICE_AUTHORIZATION_APPROVE_PATH, userCode, accessToken);
}

export function denyDeviceAuthorization(
  userCode: string,
  accessToken: string
): Promise<DeviceAuthorizationSessionView> {
  return postDeviceAuthorizationSession(DEVICE_AUTHORIZATION_DENY_PATH, userCode, accessToken);
}
