// User and profile related type definitions

import { AuthRecord, IdentifiesRecord } from './auth.js';

// User profile metadata
export interface UserMetadata {
  status?: 'active' | 'inactive' | 'suspended';
  preferences?: {
    theme?: 'light' | 'dark';
    language?: string;
    notifications?: boolean;
  };
  settings?: {
    [key: string]: string | number | boolean;
  };
  custom?: {
    [key: string]: string | number | boolean | null;
  };
}

// Profile database record
export interface ProfileRecord {
  id: string;
  auth_id: string;
  name: string;
  avatar_url?: string;
  bio?: string;
  metadata?: UserMetadata;
  created_at: string;
  updated_at: string;
}

// Combined user with profile and identities
export interface UserWithProfile extends AuthRecord {
  profile: ProfileRecord;
  identities: IdentifiesRecord[];
}

// Request to create a new user
export interface CreateUserRequest {
  email: string;
  password: string;
  name: string;
  avatar_url?: string;
  bio?: string;
  metadata?: UserMetadata;
}

// Request to update profile
export interface UpdateProfileRequest {
  name?: string;
  avatar_url?: string;
  bio?: string;
  metadata?: UserMetadata;
}
