/**
 * app.config.test.ts
 *
 * Comprehensive unit tests for loadConfig() in app.config.ts.
 *
 * Strategy:
 *   - Each test saves the current process.env, mutates it, calls loadConfig(),
 *     then restores the original env. This avoids vi.resetModules() and makes
 *     every test fully isolated.
 *
 * Coverage targets:
 *   ✅ All 11 config sections and every field inside them
 *   ✅ Default values (no env vars set)
 *   ✅ Env-var overrides (custom values respected)
 *   ✅ Numeric parsing (PORT, POSTGRES_PORT, MAX_FILE_SIZE, limits …)
 *   ✅ Optional / undefined fields (s3Bucket, accessApiKey, vercelToken …)
 *   ✅ Regression: PORT default fixed from 3000 → 7130
 *   ✅ Regression: storage.appKey defaults to 'local', not 'default-app-key'
 *   ✅ PARENT_APP_KEY whitespace trimming
 *   ✅ MAX_FILE_SIZE absent → undefined (not 0 or NaN)
 *   ✅ Deployment byte limits default to 100 MiB
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../../src/infra/config/app.config';

// ---------------------------------------------------------------------------
// Helper — save / restore process.env around each test
// ---------------------------------------------------------------------------
let savedEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  savedEnv = { ...process.env };
});

afterEach(() => {
  process.env = savedEnv;
});

// ---------------------------------------------------------------------------
// Utility to wipe a set of keys so defaults kick in cleanly
// ---------------------------------------------------------------------------
function unsetEnvKeys(...keys: string[]) {
  for (const k of keys) {
    delete process.env[k];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Section: app
// ═══════════════════════════════════════════════════════════════════════════

describe('config.app', () => {
  it('uses defaults when no env vars are set', () => {
    unsetEnvKeys('PORT', 'JWT_SECRET', 'ACCESS_API_KEY', 'LOG_LEVEL');
    const c = loadConfig();

    expect(c.app.port).toBe(7130);
    expect(c.app.jwtSecret).toBe('your_jwt_secret');
    expect(c.app.apiKey).toBe('your_api_key');
    expect(c.app.logLevel).toBe('info');
  });

  it('throws an error when required secrets are missing in production', () => {
    process.env.NODE_ENV = 'production';
    unsetEnvKeys('PORT', 'JWT_SECRET', 'ACCESS_API_KEY', 'LOG_LEVEL');
    expect(() => loadConfig()).toThrow('Missing required environment variable: JWT_SECRET');
  });

  it('overrides all app fields from env', () => {
    process.env.PORT = '9000';
    process.env.JWT_SECRET = 'super-secret-jwt';
    process.env.ACCESS_API_KEY = 'ik_test1234';
    process.env.LOG_LEVEL = 'debug';
    const c = loadConfig();

    expect(c.app.port).toBe(9000);
    expect(c.app.jwtSecret).toBe('super-secret-jwt');
    expect(c.app.apiKey).toBe('ik_test1234');
    expect(c.app.logLevel).toBe('debug');
  });

  // ── PORT regression ──────────────────────────────────────────────────────
  it('REGRESSION: PORT default is 7130 (was incorrectly 3000)', () => {
    unsetEnvKeys('PORT');
    expect(loadConfig().app.port).toBe(7130);
    expect(loadConfig().app.port).not.toBe(3000);
  });

  it('parses PORT as an integer', () => {
    process.env.PORT = '8080';
    expect(loadConfig().app.port).toBe(8080);
    expect(typeof loadConfig().app.port).toBe('number');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section: cloud
// ═══════════════════════════════════════════════════════════════════════════

describe('config.cloud', () => {
  it('uses defaults when no env vars are set', () => {
    unsetEnvKeys(
      'AWS_S3_BUCKET',
      'AWS_INSTANCE_PROFILE_NAME',
      'CLOUD_API_HOST',
      'PROJECT_ID',
      'APP_KEY',
      'AWS_CLOUDFRONT_URL',
      'AWS_CLOUDFRONT_KEY_PAIR_ID',
      'AWS_CLOUDFRONT_PRIVATE_KEY'
    );
    const c = loadConfig();

    expect(c.cloud.apiHost).toBe('https://api.insforge.dev');
    expect(c.cloud.projectId).toBe('local');
    expect(c.cloud.cloudFrontUrl).toBe('');
    expect(c.cloud.cloudFrontKeyPairId).toBe('');
    expect(c.cloud.cloudFrontPrivateKey).toBe('');
  });

  it('overrides cloud fields from env', () => {
    process.env.CLOUD_API_HOST = 'https://custom.api.dev';
    process.env.PROJECT_ID = 'proj-abc123';
    process.env.AWS_CLOUDFRONT_URL = 'https://xyz.cloudfront.net';
    process.env.AWS_CLOUDFRONT_KEY_PAIR_ID = 'K1234567890';
    process.env.AWS_CLOUDFRONT_PRIVATE_KEY = 'mock-private-key-data';
    const c = loadConfig();

    expect(c.cloud.apiHost).toBe('https://custom.api.dev');
    expect(c.cloud.projectId).toBe('proj-abc123');
    expect(c.cloud.cloudFrontUrl).toBe('https://xyz.cloudfront.net');
    expect(c.cloud.cloudFrontKeyPairId).toBe('K1234567890');
    expect(c.cloud.cloudFrontPrivateKey).toBe('mock-private-key-data');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section: denoSubhosting
// ═══════════════════════════════════════════════════════════════════════════

describe('config.denoSubhosting', () => {
  it('uses empty-string defaults when tokens are absent', () => {
    unsetEnvKeys('DENO_SUBHOSTING_TOKEN', 'DENO_SUBHOSTING_ORG_ID');
    const c = loadConfig();

    expect(c.denoSubhosting.token).toBe('');
    expect(c.denoSubhosting.organizationId).toBe('');
    expect(c.denoSubhosting.domain).toBe('functions.insforge.app');
  });

  it('reads DENO_SUBHOSTING_TOKEN and DENO_SUBHOSTING_ORG_ID', () => {
    process.env.DENO_SUBHOSTING_TOKEN = 'dsh_token_test';
    process.env.DENO_SUBHOSTING_ORG_ID = 'org-abc';
    const c = loadConfig();

    expect(c.denoSubhosting.token).toBe('dsh_token_test');
    expect(c.denoSubhosting.organizationId).toBe('org-abc');
  });

  it('domain is always the fixed constant', () => {
    // domain is hardcoded, not from env
    expect(loadConfig().denoSubhosting.domain).toBe('functions.insforge.app');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section: fly
// ═══════════════════════════════════════════════════════════════════════════

describe('config.fly', () => {
  it('uses empty-string defaults when tokens are absent', () => {
    unsetEnvKeys('FLY_API_TOKEN', 'FLY_ORG', 'COMPUTE_DOMAIN');
    const c = loadConfig();

    expect(c.fly.apiToken).toBe('');
    expect(c.fly.org).toBe('');
    expect(c.fly.domain).toBe('');
  });

  it('reads Fly env vars correctly', () => {
    process.env.FLY_API_TOKEN = 'fly-secret-token';
    process.env.FLY_ORG = 'my-org';
    process.env.COMPUTE_DOMAIN = 'compute.example.com';
    const c = loadConfig();

    expect(c.fly.apiToken).toBe('fly-secret-token');
    expect(c.fly.org).toBe('my-org');
    expect(c.fly.domain).toBe('compute.example.com');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section: server
// ═══════════════════════════════════════════════════════════════════════════

describe('config.server', () => {
  it('uses defaults when no env vars are set', () => {
    unsetEnvKeys(
      'MAX_JSON_BODY_SIZE',
      'MAX_URLENCODED_BODY_SIZE',
      'MAX_FILE_SIZE',
      'MAX_FILES_PER_FIELD',
      'LOGS_DIR'
    );
    const c = loadConfig();

    expect(c.server.maxJsonBodySize).toBe('100mb');
    expect(c.server.maxUrlencodedBodySize).toBe('10mb');
    expect(c.server.maxFileSize).toBeUndefined();
    expect(c.server.maxFilesPerField).toBe(10);
    expect(typeof c.server.logsDir).toBe('string');
    expect(c.server.logsDir.length).toBeGreaterThan(0);
  });

  it('overrides body size limits', () => {
    process.env.MAX_JSON_BODY_SIZE = '50mb';
    process.env.MAX_URLENCODED_BODY_SIZE = '5mb';
    const c = loadConfig();

    expect(c.server.maxJsonBodySize).toBe('50mb');
    expect(c.server.maxUrlencodedBodySize).toBe('5mb');
  });

  it('parses MAX_FILE_SIZE as number when set', () => {
    process.env.MAX_FILE_SIZE = '52428800'; // 50 MiB
    const c = loadConfig();

    expect(c.server.maxFileSize).toBe(52428800);
    expect(typeof c.server.maxFileSize).toBe('number');
  });

  it('MAX_FILE_SIZE is undefined when not set (not 0 or NaN)', () => {
    unsetEnvKeys('MAX_FILE_SIZE');
    const c = loadConfig();

    expect(c.server.maxFileSize).toBeUndefined();
    expect(c.server.maxFileSize).not.toBe(0);
    expect(c.server.maxFileSize).not.toBeNaN();
  });

  it('parses MAX_FILES_PER_FIELD as number', () => {
    process.env.MAX_FILES_PER_FIELD = '25';
    expect(loadConfig().server.maxFilesPerField).toBe(25);
  });

  it('reads LOGS_DIR when set', () => {
    process.env.LOGS_DIR = '/var/log/insforge';
    expect(loadConfig().server.logsDir).toBe('/var/log/insforge');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section: database
// ═══════════════════════════════════════════════════════════════════════════

describe('config.database', () => {
  it('uses defaults when no env vars are set', () => {
    unsetEnvKeys(
      'POSTGRES_HOST',
      'POSTGRES_PORT',
      'POSTGRES_DB',
      'POSTGRES_USER',
      'POSTGRES_PASSWORD',
      'DATABASE_DIR',
      'POSTGREST_BASE_URL'
    );
    const c = loadConfig();

    expect(c.database.host).toBe('localhost');
    expect(c.database.port).toBe(5432);
    expect(c.database.name).toBe('insforge');
    expect(c.database.user).toBe('postgres');
    expect(c.database.password).toBe('postgres');
    expect(c.database.postgrestBaseUrl).toBe('http://localhost:5430');
    expect(typeof c.database.dir).toBe('string');
  });

  it('overrides all database fields', () => {
    process.env.POSTGRES_HOST = 'db.internal';
    process.env.POSTGRES_PORT = '5433';
    process.env.POSTGRES_DB = 'myapp';
    process.env.POSTGRES_USER = 'dbuser';
    process.env.POSTGRES_PASSWORD = 'securepass';
    process.env.POSTGREST_BASE_URL = 'http://postgrest:3000';
    const c = loadConfig();

    expect(c.database.host).toBe('db.internal');
    expect(c.database.port).toBe(5433);
    expect(c.database.name).toBe('myapp');
    expect(c.database.user).toBe('dbuser');
    expect(c.database.password).toBe('securepass');
    expect(c.database.postgrestBaseUrl).toBe('http://postgrest:3000');
  });

  it('parses POSTGRES_PORT as integer', () => {
    process.env.POSTGRES_PORT = '5435';
    expect(loadConfig().database.port).toBe(5435);
    expect(typeof loadConfig().database.port).toBe('number');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section: auth
// ═══════════════════════════════════════════════════════════════════════════

describe('config.auth', () => {
  it('uses defaults when no env vars are set', () => {
    unsetEnvKeys('ADMIN_EMAIL', 'ADMIN_PASSWORD', 'ACCESS_API_KEY');
    const c = loadConfig();

    expect(c.auth.adminEmail).toBe('admin@example.com');
    expect(c.auth.adminPassword).toBe('change-this-password');
    expect(c.auth.accessApiKey).toBeUndefined();
  });

  it('throws an error when admin credentials are missing in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'test-secret';
    process.env.ACCESS_API_KEY = 'test-key';
    unsetEnvKeys('ADMIN_EMAIL', 'ADMIN_PASSWORD');
    expect(() => loadConfig()).toThrow('Missing required environment variable: ADMIN_EMAIL');
  });

  it('overrides admin credentials', () => {
    process.env.ADMIN_EMAIL = 'superadmin@company.com';
    process.env.ADMIN_PASSWORD = 'ultrasecure!99';
    const c = loadConfig();

    expect(c.auth.adminEmail).toBe('superadmin@company.com');
    expect(c.auth.adminPassword).toBe('ultrasecure!99');
  });

  it('accessApiKey is set when ACCESS_API_KEY env var is present', () => {
    process.env.ACCESS_API_KEY = 'ik_abc123def456';
    expect(loadConfig().auth.accessApiKey).toBe('ik_abc123def456');
  });

  it('accessApiKey is undefined when ACCESS_API_KEY is not set', () => {
    unsetEnvKeys('ACCESS_API_KEY');
    expect(loadConfig().auth.accessApiKey).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section: storage
// ═══════════════════════════════════════════════════════════════════════════

describe('config.storage', () => {
  it('uses defaults when no env vars are set', () => {
    unsetEnvKeys(
      'AWS_S3_BUCKET',
      'APP_KEY',
      'PARENT_APP_KEY',
      'AWS_REGION',
      'STORAGE_DIR',
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'S3_ENDPOINT_URL',
      'AWS_CONFIG_BUCKET',
      'AWS_CONFIG_REGION'
    );
    const c = loadConfig();

    expect(c.storage.s3Bucket).toBeUndefined();
    expect(c.storage.appKey).toBe('local');
    expect(c.storage.parentAppKey).toBeUndefined();
    expect(c.storage.awsRegion).toBe('us-east-2');
    expect(c.storage.s3AccessKeyId).toBeUndefined();
    expect(c.storage.s3SecretAccessKey).toBeUndefined();
    expect(c.storage.awsAccessKeyId).toBeUndefined();
    expect(c.storage.awsSecretAccessKey).toBeUndefined();
    expect(c.storage.s3EndpointUrl).toBeUndefined();
    expect(c.storage.awsConfigBucket).toBe('insforge-config');
    expect(c.storage.awsConfigRegion).toBe('us-east-2');
    expect(typeof c.storage.storageDir).toBe('string');
  });

  // ── storage.appKey regression ─────────────────────────────────────────────
  it('REGRESSION: storage.appKey defaults to "local" (not "default-app-key")', () => {
    unsetEnvKeys('APP_KEY');
    expect(loadConfig().storage.appKey).toBe('local');
    expect(loadConfig().storage.appKey).not.toBe('default-app-key');
  });

  it('overrides S3 bucket and region', () => {
    process.env.AWS_S3_BUCKET = 'my-production-bucket';
    process.env.AWS_REGION = 'eu-west-1';
    const c = loadConfig();

    expect(c.storage.s3Bucket).toBe('my-production-bucket');
    expect(c.storage.awsRegion).toBe('eu-west-1');
  });

  it('sets s3Bucket to undefined when AWS_S3_BUCKET is not set', () => {
    unsetEnvKeys('AWS_S3_BUCKET');
    expect(loadConfig().storage.s3Bucket).toBeUndefined();
  });

  it('reads S3-specific credentials when set', () => {
    process.env.S3_ACCESS_KEY_ID = 's3-key-id';
    process.env.S3_SECRET_ACCESS_KEY = 's3-secret';
    const c = loadConfig();

    expect(c.storage.s3AccessKeyId).toBe('s3-key-id');
    expect(c.storage.s3SecretAccessKey).toBe('s3-secret');
  });

  it('reads AWS credentials when set', () => {
    process.env.AWS_ACCESS_KEY_ID = 'test-aws-access-key-id';
    process.env.AWS_SECRET_ACCESS_KEY = 'test-aws-secret-access-key';
    const c = loadConfig();

    expect(c.storage.awsAccessKeyId).toBe('test-aws-access-key-id');
    expect(c.storage.awsSecretAccessKey).toBe('test-aws-secret-access-key');
  });

  it('reads S3_ENDPOINT_URL when set', () => {
    process.env.S3_ENDPOINT_URL = 'https://s3.wasabisys.com';
    expect(loadConfig().storage.s3EndpointUrl).toBe('https://s3.wasabisys.com');
  });

  it('S3_ENDPOINT_URL is undefined when not set', () => {
    unsetEnvKeys('S3_ENDPOINT_URL');
    expect(loadConfig().storage.s3EndpointUrl).toBeUndefined();
  });

  it('reads PARENT_APP_KEY and trims whitespace', () => {
    process.env.PARENT_APP_KEY = '  parent-key  ';
    expect(loadConfig().storage.parentAppKey).toBe('parent-key');
  });

  it('PARENT_APP_KEY is undefined when set to only whitespace', () => {
    process.env.PARENT_APP_KEY = '   ';
    expect(loadConfig().storage.parentAppKey).toBeUndefined();
  });

  it('PARENT_APP_KEY is undefined when not set', () => {
    unsetEnvKeys('PARENT_APP_KEY');
    expect(loadConfig().storage.parentAppKey).toBeUndefined();
  });

  it('reads STORAGE_DIR from env', () => {
    process.env.STORAGE_DIR = '/data/insforge-storage';
    expect(loadConfig().storage.storageDir).toBe('/data/insforge-storage');
  });

  it('reads config bucket overrides', () => {
    process.env.AWS_CONFIG_BUCKET = 'my-config-bucket';
    process.env.AWS_CONFIG_REGION = 'ap-southeast-1';
    const c = loadConfig();

    expect(c.storage.awsConfigBucket).toBe('my-config-bucket');
    expect(c.storage.awsConfigRegion).toBe('ap-southeast-1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section: functions
// ═══════════════════════════════════════════════════════════════════════════

describe('config.functions', () => {
  it('uses default Deno runtime URL', () => {
    unsetEnvKeys('DENO_RUNTIME_URL');
    expect(loadConfig().functions.denoRuntimeUrl).toBe('http://localhost:7133');
  });

  it('overrides Deno runtime URL', () => {
    process.env.DENO_RUNTIME_URL = 'http://deno-runtime:7133';
    expect(loadConfig().functions.denoRuntimeUrl).toBe('http://deno-runtime:7133');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section: deployments
// ═══════════════════════════════════════════════════════════════════════════

describe('config.deployments', () => {
  const ONE_HUNDRED_MIB = 100 * 1024 * 1024;

  it('optional Vercel fields are undefined when not set', () => {
    unsetEnvKeys('VERCEL_TOKEN', 'VERCEL_TEAM_ID', 'VERCEL_PROJECT_ID');
    const c = loadConfig();

    expect(c.deployments.vercelToken).toBeUndefined();
    expect(c.deployments.vercelTeamId).toBeUndefined();
    expect(c.deployments.vercelProjectId).toBeUndefined();
  });

  it('reads Vercel credentials from env', () => {
    process.env.VERCEL_TOKEN = 'vcel_token_abc';
    process.env.VERCEL_TEAM_ID = 'team_xyz';
    process.env.VERCEL_PROJECT_ID = 'prj_123';
    const c = loadConfig();

    expect(c.deployments.vercelToken).toBe('vcel_token_abc');
    expect(c.deployments.vercelTeamId).toBe('team_xyz');
    expect(c.deployments.vercelProjectId).toBe('prj_123');
  });

  it('deployment size limits use 100 MiB defaults', () => {
    unsetEnvKeys('MAX_DEPLOYMENT_FILES', 'MAX_DEPLOYMENT_TOTAL_BYTES', 'MAX_DEPLOYMENT_FILE_BYTES');
    const c = loadConfig();

    expect(c.deployments.maxDeploymentFiles).toBe(5000);
    expect(c.deployments.maxDeploymentTotalBytes).toBe(ONE_HUNDRED_MIB);
    expect(c.deployments.maxDeploymentFileBytes).toBe(ONE_HUNDRED_MIB);
  });

  it('deployment size limits are parsed as integers from env', () => {
    process.env.MAX_DEPLOYMENT_FILES = '1000';
    process.env.MAX_DEPLOYMENT_TOTAL_BYTES = '52428800';
    process.env.MAX_DEPLOYMENT_FILE_BYTES = '10485760';
    const c = loadConfig();

    expect(c.deployments.maxDeploymentFiles).toBe(1000);
    expect(c.deployments.maxDeploymentTotalBytes).toBe(52428800);
    expect(c.deployments.maxDeploymentFileBytes).toBe(10485760);
    expect(typeof c.deployments.maxDeploymentFiles).toBe('number');
    expect(typeof c.deployments.maxDeploymentTotalBytes).toBe('number');
    expect(typeof c.deployments.maxDeploymentFileBytes).toBe('number');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section: ai
// ═══════════════════════════════════════════════════════════════════════════

describe('config.ai', () => {
  it('openrouterApiKey is undefined when not set', () => {
    unsetEnvKeys('OPENROUTER_API_KEY');
    expect(loadConfig().ai.openrouterApiKey).toBeUndefined();
  });

  it('reads OPENROUTER_API_KEY when set', () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test-key-12345';
    expect(loadConfig().ai.openrouterApiKey).toBe('sk-or-test-key-12345');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// loadConfig() structural integrity
// ═══════════════════════════════════════════════════════════════════════════

describe('loadConfig() structural integrity', () => {
  it('returns a complete object with all 11 top-level sections', () => {
    const c = loadConfig();

    expect(c).toHaveProperty('app');
    expect(c).toHaveProperty('cloud');
    expect(c).toHaveProperty('denoSubhosting');
    expect(c).toHaveProperty('fly');
    expect(c).toHaveProperty('server');
    expect(c).toHaveProperty('database');
    expect(c).toHaveProperty('auth');
    expect(c).toHaveProperty('storage');
    expect(c).toHaveProperty('functions');
    expect(c).toHaveProperty('deployments');
    expect(c).toHaveProperty('ai');
  });

  it('returns a new object each time (not a cached singleton)', () => {
    process.env.PORT = '8001';
    const c1 = loadConfig();
    process.env.PORT = '8002';
    const c2 = loadConfig();

    expect(c1.app.port).toBe(8001);
    expect(c2.app.port).toBe(8002);
    expect(c1).not.toBe(c2);
  });

  it('all numeric fields are actual numbers (not strings)', () => {
    const c = loadConfig();

    expect(typeof c.app.port).toBe('number');
    expect(typeof c.database.port).toBe('number');
    expect(typeof c.server.maxFilesPerField).toBe('number');
    expect(typeof c.deployments.maxDeploymentFiles).toBe('number');
    expect(typeof c.deployments.maxDeploymentTotalBytes).toBe('number');
    expect(typeof c.deployments.maxDeploymentFileBytes).toBe('number');
  });

  it('no numeric field is NaN', () => {
    const c = loadConfig();

    expect(c.app.port).not.toBeNaN();
    expect(c.database.port).not.toBeNaN();
    expect(c.server.maxFilesPerField).not.toBeNaN();
    expect(c.deployments.maxDeploymentFiles).not.toBeNaN();
    expect(c.deployments.maxDeploymentTotalBytes).not.toBeNaN();
    expect(c.deployments.maxDeploymentFileBytes).not.toBeNaN();
  });
});
