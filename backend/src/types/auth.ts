// Type definitions for database user records
export interface UserRecord {
  id: string;
  email: string;
  name: string;
  email_verified: boolean;
  created_at: string;
  updated_at: string;
  password: string | null;
  providers: string | null;
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

// Type definitions for OAuth providers
export interface GoogleUserInfo {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  given_name?: string;
  family_name?: string;
  locale?: string;
}

export interface GitHubUserInfo {
  id: number;
  login: string;
  name?: string;
  email?: string;
  avatar_url?: string;
}

export interface GitHubEmailInfo {
  email: string;
  primary: boolean;
  verified: boolean;
  visibility?: string;
}

export interface MicrosoftUserInfo {
  id: string;
  email: string;
  name: string;
  avatar_url?: string;
}
export interface DiscordUserInfo {
  id: string;
  username: string;
  email?: string;
  avatar?: string;
}

export interface LinkedInUserInfo {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  given_name?: string;
  family_name?: string;
  locale?: string;
}

export interface FacebookUserInfo {
  id: string;
  email: string;
  name?: string;
  picture?: {
    data?: {
      url?: string;
    };
  };
  first_name?: string;
  last_name?: string;
}

export interface XUserInfo {
  id: string;
  name: string;
  username?: string;
  profile_image_url?: string;
  verified?: boolean;
  created_at?: string;
}
