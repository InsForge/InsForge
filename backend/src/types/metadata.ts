// Application metadata type definitions

import { DatabaseSchema } from './database.js';
import { StorageConfig } from './storage.js';
import { AuthConfig } from './auth.js';

// Complete application metadata structure
export interface AppMetadata {
  database: DatabaseSchema;
  auth: AuthConfig;
  storage: StorageConfig;
  version?: string;
}
