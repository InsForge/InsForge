// Server-side mirror of CLI/src/lib/config-schema.ts.
// Duplicated intentionally for v1; hoist into @insforge/shared-schemas in a follow-up.

export interface InsforgeConfig {
  project_id?: string;
  auth?: AuthConfig;
  storage?: StorageConfig;
}

export interface AuthConfig {
  additional_redirect_urls?: string[];
}

export interface StorageConfig {
  buckets?: Record<string, BucketConfig>;
}

export interface BucketConfig {
  public?: boolean;
}

export class ConfigValidationError extends Error {
  constructor(
    public readonly path: string,
    message: string
  ) {
    super(`config.${path}: ${message}`);
    this.name = 'ConfigValidationError';
  }
}

export function validateConfig(input: unknown): InsforgeConfig {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new ConfigValidationError('', 'must be an object');
  }
  const obj = input as Record<string, unknown>;
  const out: InsforgeConfig = {};
  if ('project_id' in obj) {
    if (typeof obj.project_id !== 'string') {
      throw new ConfigValidationError('project_id', 'must be a string');
    }
    out.project_id = obj.project_id;
  }
  if ('auth' in obj) {
    out.auth = validateAuth(obj.auth);
  }
  if ('storage' in obj) {
    out.storage = validateStorage(obj.storage);
  }
  return out;
}

function validateAuth(input: unknown): AuthConfig {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new ConfigValidationError('auth', 'must be an object');
  }
  const obj = input as Record<string, unknown>;
  const out: AuthConfig = {};
  if ('additional_redirect_urls' in obj) {
    if (
      !Array.isArray(obj.additional_redirect_urls) ||
      !obj.additional_redirect_urls.every((u) => typeof u === 'string')
    ) {
      throw new ConfigValidationError(
        'auth.additional_redirect_urls',
        'must be an array of strings'
      );
    }
    out.additional_redirect_urls = obj.additional_redirect_urls;
  }
  return out;
}

function validateStorage(input: unknown): StorageConfig {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new ConfigValidationError('storage', 'must be an object');
  }
  const obj = input as Record<string, unknown>;
  const out: StorageConfig = {};
  if ('buckets' in obj) {
    if (obj.buckets === null || typeof obj.buckets !== 'object' || Array.isArray(obj.buckets)) {
      throw new ConfigValidationError('storage.buckets', 'must be an object map');
    }
    out.buckets = {};
    for (const [name, raw] of Object.entries(obj.buckets as Record<string, unknown>)) {
      out.buckets[name] = validateBucket(`storage.buckets.${name}`, raw);
    }
  }
  return out;
}

function validateBucket(path: string, input: unknown): BucketConfig {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new ConfigValidationError(path, 'must be an object');
  }
  const obj = input as Record<string, unknown>;
  const out: BucketConfig = {};
  if ('public' in obj) {
    if (typeof obj.public !== 'boolean') {
      throw new ConfigValidationError(`${path}.public`, 'must be a boolean');
    }
    out.public = obj.public;
  }
  return out;
}
