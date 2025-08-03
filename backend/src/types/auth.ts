// Authentication-related type definitions

// Authentication configuration
export interface AuthConfig {
  enabled: boolean;
  providers: string[];
  magicLink: boolean;
}

// OAuth provider data from external providers
export interface OAuthIdentityData {
  sub?: string; // Subject identifier from provider
  email?: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  locale?: string;
  [key: string]: string | boolean | number | undefined;
}

// Auth database record
export interface AuthRecord {
  id: string;
  email: string;
  password_hash: string;
  created_at: string;
  updated_at: string;
}

// Identity record for OAuth providers
export interface IdentifiesRecord {
  auth_id: string;
  provider?: string;
  provider_id?: string;
  identity_data?: OAuthIdentityData;
  email?: string;
  last_login_at?: string;
  created_at: string;
  updated_at: string;
}

// Superuser auth record
export interface SuperUserAuthRecord {
  id: string;
  email: string;
  password_hash: string;
  created_at: string;
  updated_at: string;
}

// Superuser profile record
export interface SuperUserProfileRecord {
  id: string;
  auth_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

// OAuth provider configuration
export interface OAuthProviderConfig {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
}

// OAuth configuration for all providers
export interface OAuthConfig {
  google: OAuthProviderConfig;
  github: OAuthProviderConfig;
}

// OAuth status (public endpoint)
export interface OAuthStatus {
  google: { enabled: boolean };
  github: { enabled: boolean };
}

// Database configuration record (generic, could be moved to database types)
export interface ConfigRecord {
  key: string;
  value: string;
}
