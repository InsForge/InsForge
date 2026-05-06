// Thin wrapper around AuthConfigService that exposes the auth knobs the
// config service needs. The shape here uses the field names the
// `insforge.toml` config schema expects (`jwt_expiry`, `enable_signup`,
// `site_url`, `additional_redirect_urls`), and maps them to/from the
// underlying `auth.config` row.
//
// IMPORTANT: the live OSS auth.config schema does NOT currently store
// `jwt_expiry`, `enable_signup`, or `site_url` — only `allowedRedirectUrls`
// has a direct equivalent. The other three are returned as `undefined` from
// the reader and ignored by the writer until the auth.config table grows
// real columns for them. See spec for follow-up matrix-fill.

import { AuthConfigService } from './auth-config.service.js';

export interface AuthSettings {
  jwtExpiry?: number;
  enableSignup?: boolean;
  siteUrl?: string;
  additionalRedirectUrls: string[];
}

export interface AuthSettingsUpdate {
  jwtExpiry?: number;
  enableSignup?: boolean;
  siteUrl?: string;
  additionalRedirectUrls?: string[];
}

export async function getAuthSettings(): Promise<AuthSettings> {
  const config = await AuthConfigService.getInstance().getAuthConfig();
  return {
    jwtExpiry: undefined,
    enableSignup: undefined,
    siteUrl: undefined,
    additionalRedirectUrls: config.allowedRedirectUrls ?? [],
  };
}

export async function setAuthSettings(input: AuthSettingsUpdate): Promise<void> {
  // Only the allowedRedirectUrls field has a real backing column today.
  // jwtExpiry / enableSignup / siteUrl are accepted but ignored at the DB
  // layer until the auth.config table grows columns for them.
  if (input.additionalRedirectUrls !== undefined) {
    await AuthConfigService.getInstance().updateAuthConfig({
      allowedRedirectUrls: input.additionalRedirectUrls,
    });
  }
}
