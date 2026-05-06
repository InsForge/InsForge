// Thin wrapper around AuthConfigService that exposes the auth knobs the
// config service needs. The shape here uses the field names the
// `insforge.toml` config schema expects (currently just
// `additional_redirect_urls`), and maps them to/from the underlying
// `auth.config` row.
//
// The MVP `[auth]` scope is intentionally narrow: only
// `additional_redirect_urls` has a backing column on `auth.config` today.
// `jwt_expiry`, `enable_signup`, and `site_url` are punted to a follow-up
// plan that grows the table to match.

import { AuthConfigService } from './auth-config.service.js';

export interface AuthSettings {
  additionalRedirectUrls: string[];
}

export interface AuthSettingsUpdate {
  additionalRedirectUrls?: string[];
}

export async function getAuthSettings(): Promise<AuthSettings> {
  const config = await AuthConfigService.getInstance().getAuthConfig();
  return {
    additionalRedirectUrls: config.allowedRedirectUrls ?? [],
  };
}

export async function setAuthSettings(input: AuthSettingsUpdate): Promise<void> {
  if (input.additionalRedirectUrls !== undefined) {
    await AuthConfigService.getInstance().updateAuthConfig({
      allowedRedirectUrls: input.additionalRedirectUrls,
    });
  }
}
