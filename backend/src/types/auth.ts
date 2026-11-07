// Type definitions for database user records

export interface UserRecord {
  id: string;
  email: string;
  profile: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  email_verified: boolean;
  is_anonymous: boolean;
  created_at: string;
  updated_at: string;
  password?: string;
  providers?: string;
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

export interface AppleUserInfo {
  sub: string;
  email: string;
  email_verified?: boolean;
  is_private_email?: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
}

// Generic OAuth user data returned by provider services
export interface OAuthUserData {
  provider: string;
  providerId: string;
  email: string;
  userName: string;
  avatarUrl: string;
  identityData:
    | GoogleUserInfo
    | GitHubUserInfo
    | DiscordUserInfo
    | LinkedInUserInfo
    | FacebookUserInfo
    | MicrosoftUserInfo
    | XUserInfo
    | AppleUserInfo
    | Record<string, unknown>;
}
