import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import fs from 'fs';
import { parseTrustProxySetting, TrustProxySetting } from '../../utils/trust-proxy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Timing Fix: Load .env file from the root directory before configuration parses.
// We search upwards from __dirname or check a few relative locations to ensure robust path resolution in both source and build dist modes.
const envPaths = [
  path.resolve(__dirname, '../../../../.env'), // Source mode: backend/src/infra/config/app.config.ts -> root/.env
  path.resolve(__dirname, '../../../.env'), // Alternative source mode
  path.resolve(process.cwd(), '.env'), // Current working directory (usually root for dev/prod servers)
  path.resolve(process.cwd(), '../.env'), // One level above process.cwd()
];
const envPath = envPaths.find((p) => fs.existsSync(p));
if (envPath) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

// ─────────────────────────────────────────────────────────────────────────────
// AppConfig — canonical backend environment schema.
//
// This is the single source of truth for every env var the backend reads.
// All runtime code must import `config` from here instead of reading
// `process.env` directly.  Numeric / boolean parsing happens once here so
// call-sites always receive the correct type.
//
// Dynamic env lookups that are data-driven at call-time (e.g. OAuth provider
// credentials keyed by provider name, seed.ts, environment.ts helpers) are
// intentionally kept as direct process.env reads in their own files.
// ─────────────────────────────────────────────────────────────────────────────

export interface AppConfig {
  // ── existing sections (unchanged) ─────────────────────────────────────────

  /** Core app / server identity. */
  app: {
    /** HTTP port the Express server listens on. env: PORT */
    port: number;
    /** HS256 signing secret for JWTs. env: JWT_SECRET */
    jwtSecret: string;
    /** Static API key for privileged access. env: ACCESS_API_KEY */
    apiKey: string;
    /** Winston log level. env: LOG_LEVEL */
    logLevel: string;
  };

  /** InsForge Cloud / AWS infrastructure settings. */
  cloud: {
    /** S3 bucket name. env: AWS_S3_BUCKET */
    storageBucket: string;
    /** EC2 instance profile name (presence → cloud env). env: AWS_INSTANCE_PROFILE_NAME */
    instanceProfile: string;
    /** Base URL of the InsForge Cloud API. env: CLOUD_API_HOST */
    apiHost: string;
    /** Per-project identifier used as S3 prefix. env: APP_KEY */
    appKey: string;
    /** CloudFront distribution URL. env: AWS_CLOUDFRONT_URL */
    cloudFrontUrl: string;
    /** CloudFront signing key-pair ID. env: AWS_CLOUDFRONT_KEY_PAIR_ID */
    cloudFrontKeyPairId: string;
    /** CloudFront RSA private key (PEM). env: AWS_CLOUDFRONT_PRIVATE_KEY */
    cloudFrontPrivateKey: string;
    /** Project ID for multi-tenant cloud deployments. env: PROJECT_ID */
    projectId: string;
  };

  /** Deno Subhosting edge-function runtime (cloud only). */
  denoSubhosting: {
    /** API token. env: DENO_SUBHOSTING_TOKEN */
    token: string;
    /** Organisation ID. env: DENO_SUBHOSTING_ORG_ID */
    organizationId: string;
    /** Public domain for deployed functions. */
    domain: string;
  };

  /** Fly.io compute provider (self-host opt-in via FLY_API_TOKEN + FLY_ORG). */
  fly: {
    /** Fly personal access token. env: FLY_API_TOKEN */
    apiToken: string;
    /** Fly organisation slug. env: FLY_ORG */
    org: string;
    /** Public domain for compute services. env: COMPUTE_DOMAIN */
    domain: string;
  };

  // ── new sections ───────────────────────────────────────────────────────────

  /**
   * HTTP server / request limits.
   * Centralises the body-size and upload-size guards that were previously
   * duplicated between server.ts, upload.ts, and storage-config.service.ts.
   */
  server: {
    /** express.json() body size limit. env: MAX_JSON_BODY_SIZE */
    maxJsonBodySize: string;
    /** express.urlencoded() body size limit. env: MAX_URLENCODED_BODY_SIZE */
    maxUrlencodedBodySize: string;
    /**
     * Maximum file upload size in bytes.
     * env: MAX_FILE_SIZE — undefined when not set (no cap beyond OS limits).
     */
    maxFileSize: number | undefined;
    /** Maximum number of files per multipart field. env: MAX_FILES_PER_FIELD */
    maxFilesPerField: number;
    /** Directory for Winston file-transport logs. env: LOGS_DIR */
    logsDir: string;
    /** Trust proxy configuration. env: TRUST_PROXY */
    trustProxy: TrustProxySetting;
  };

  /**
   * PostgreSQL + PostgREST connection settings.
   * Replaces the duplicate pool configs in database.manager.ts (×2) and seed.ts.
   */
  database: {
    /** Postgres host. env: POSTGRES_HOST */
    host: string;
    /** Postgres port (parsed to number). env: POSTGRES_PORT */
    port: number;
    /** Postgres database name. env: POSTGRES_DB */
    name: string;
    /** Postgres role / user. env: POSTGRES_USER */
    user: string;
    /** Postgres password. env: POSTGRES_PASSWORD */
    password: string;
    /** Directory for SQLite / metadata files. env: DATABASE_DIR */
    dir: string;
    /** Internal PostgREST base URL. env: POSTGREST_BASE_URL */
    postgrestBaseUrl: string;
  };

  /**
   * Admin bootstrap credentials.
   * Used only during seed to create the first admin user.
   */
  auth: {
    /** Admin e-mail seeded on first boot. env: ADMIN_EMAIL */
    adminEmail: string;
    /** Admin password seeded on first boot. env: ADMIN_PASSWORD */
    adminPassword: string;
    /** Pre-set API key seeded on first boot. env: ACCESS_API_KEY */
    accessApiKey: string | undefined;
  };

  /**
   * Storage / S3 settings.
   * Unifies the reads scattered across storage.service.ts, s3.provider.ts,
   * s3-config-loader.ts, s3-sigv4.ts, and deployment.service.ts.
   *
   * When s3Bucket is undefined the backend falls back to local filesystem
   * storage — no S3 credentials are required in that case.
   */
  storage: {
    /** S3 bucket name. env: AWS_S3_BUCKET — undefined → use local FS */
    s3Bucket: string | undefined;
    /**
     * Per-project key used as S3 object prefix and function namespace.
     * env: APP_KEY — defaults to 'local' for self-hosters.
     */
    appKey: string;
    /**
     * Parent project key for branch (preview) environments.
     * env: PARENT_APP_KEY — undefined in non-branch deployments.
     */
    parentAppKey: string | undefined;
    /** AWS / S3-compatible region. env: AWS_REGION */
    awsRegion: string;
    /** Base directory for local filesystem storage. env: STORAGE_DIR */
    storageDir: string;
    /**
     * S3-specific access key (Wasabi, MinIO, etc.).
     * Falls back to AWS_ACCESS_KEY_ID when absent.
     * env: S3_ACCESS_KEY_ID
     */
    s3AccessKeyId: string | undefined;
    /**
     * S3-specific secret key.
     * env: S3_SECRET_ACCESS_KEY
     */
    s3SecretAccessKey: string | undefined;
    /** AWS access key ID (used for S3, CloudWatch, etc.). env: AWS_ACCESS_KEY_ID */
    awsAccessKeyId: string | undefined;
    /** AWS secret access key. env: AWS_SECRET_ACCESS_KEY */
    awsSecretAccessKey: string | undefined;
    /**
     * Custom S3-compatible endpoint URL (Wasabi, MinIO, R2, etc.).
     * env: S3_ENDPOINT_URL — undefined → use standard AWS endpoints.
     */
    s3EndpointUrl: string | undefined;
    /** S3 bucket used for cloud config blobs. env: AWS_CONFIG_BUCKET */
    awsConfigBucket: string;
    /** Region for the config bucket. env: AWS_CONFIG_REGION */
    awsConfigRegion: string;
  };

  /** Edge-function / Deno runtime settings. */
  functions: {
    /** URL of the local Deno serverless runtime. env: DENO_RUNTIME_URL */
    denoRuntimeUrl: string;
  };

  /** Site deployment providers. */
  deployments: {
    /** Vercel personal / team access token. env: VERCEL_TOKEN */
    vercelToken: string | undefined;
    /** Vercel team ID for deployments. env: VERCEL_TEAM_ID */
    vercelTeamId: string | undefined;
    /** Vercel project ID. env: VERCEL_PROJECT_ID */
    vercelProjectId: string | undefined;
    /** Max number of files per deployment. env: MAX_DEPLOYMENT_FILES */
    maxDeploymentFiles: number;
    /** Max total bytes per deployment. env: MAX_DEPLOYMENT_TOTAL_BYTES */
    maxDeploymentTotalBytes: number;
    /** Max bytes per individual deployment file. env: MAX_DEPLOYMENT_FILE_BYTES */
    maxDeploymentFileBytes: number;
  };

  /** AI / LLM gateway settings. */
  ai: {
    /** OpenRouter API key for self-hosted AI gateway. env: OPENROUTER_API_KEY */
    openrouterApiKey: string | undefined;
  };
}

/** Safe positive integer parser with default fallback to avoid NaN, zero, or negative leakages */
function parseEnvInt(val: string | undefined, fallback: number): number {
  if (!val) return fallback;
  const parsed = parseInt(val, 10);
  return isNaN(parsed) || parsed <= 0 ? fallback : parsed;
}

/** Fail-fast helper that requires environment variables to be set in production */
function requireEnv(key: string, devFallback: string): string {
  const val = process.env[key]?.trim();
  if (val) return val;
  if (process.env.NODE_ENV !== 'production') return devFallback;
  throw new Error(`Missing required environment variable: ${key}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// loadConfig — factory function that reads process.env and returns AppConfig.
//
// Exported separately from the `config` singleton so unit tests can call it
// after mutating process.env (e.g. `process.env.PORT = '9000'`) without
// needing vi.resetModules() or dynamic imports.
// ─────────────────────────────────────────────────────────────────────────────

export function loadConfig(): AppConfig {
  return {
    // ── existing sections (values unchanged, PORT default fixed) ─────────────

    app: {
      // BUG FIX: was '3000', conflicting with server.ts which defaulted to '7130'.
      // '7130' matches docker-compose.yml, server.ts, and the documented default.
      port: parseEnvInt(process.env.PORT, 7130),
      jwtSecret: requireEnv('JWT_SECRET', 'your_jwt_secret'),
      apiKey: process.env.ACCESS_API_KEY || 'your_api_key',
      logLevel: process.env.LOG_LEVEL || 'info',
    },

    cloud: {
      storageBucket: process.env.AWS_S3_BUCKET || 'insforge-test-bucket',
      instanceProfile: process.env.AWS_INSTANCE_PROFILE_NAME || 'insforge-instance-profile',
      apiHost: process.env.CLOUD_API_HOST || 'https://api.insforge.dev',
      projectId: process.env.PROJECT_ID || 'local',
      appKey: process.env.APP_KEY || 'default-app-key',
      cloudFrontUrl: process.env.AWS_CLOUDFRONT_URL || '',
      cloudFrontKeyPairId: process.env.AWS_CLOUDFRONT_KEY_PAIR_ID || '',
      cloudFrontPrivateKey: process.env.AWS_CLOUDFRONT_PRIVATE_KEY || '',
    },

    denoSubhosting: {
      token: process.env.DENO_SUBHOSTING_TOKEN || '',
      organizationId: process.env.DENO_SUBHOSTING_ORG_ID || '',
      domain: 'functions.insforge.app',
    },

    fly: {
      // Self-hosters enable compute by setting both FLY_API_TOKEN and FLY_ORG.
      // Presence of credentials is the opt-in — no separate ENABLED flag.
      apiToken: process.env.FLY_API_TOKEN || '',
      // FLY_ORG must be set explicitly; defaulting to "insforge" caused
      // self-hosters to attempt to create apps inside our internal org and get
      // an opaque auth error from Fly. Empty string makes the misconfig
      // detectable so we can warn at startup.
      org: process.env.FLY_ORG || '',
      domain: process.env.COMPUTE_DOMAIN || '',
    },

    // ── new sections ──────────────────────────────────────────────────────────

    server: {
      maxJsonBodySize: process.env.MAX_JSON_BODY_SIZE || '100mb',
      maxUrlencodedBodySize: process.env.MAX_URLENCODED_BODY_SIZE || '10mb',
      maxFileSize: (() => {
        const parsed = parseInt(process.env.MAX_FILE_SIZE || '', 10);
        return isNaN(parsed) || parsed <= 0 ? undefined : parsed;
      })(),
      maxFilesPerField: parseEnvInt(process.env.MAX_FILES_PER_FIELD, 10),
      logsDir: process.env.LOGS_DIR || path.join(__dirname, '../../logs'),
      trustProxy: parseTrustProxySetting(process.env.TRUST_PROXY),
    },

    database: {
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseEnvInt(process.env.POSTGRES_PORT, 5432),
      name: process.env.POSTGRES_DB || 'insforge',
      user: process.env.POSTGRES_USER || 'postgres',
      password: process.env.POSTGRES_PASSWORD || 'postgres',
      dir: process.env.DATABASE_DIR || path.join(__dirname, '../../data'),
      postgrestBaseUrl: process.env.POSTGREST_BASE_URL || 'http://localhost:5430',
    },

    auth: {
      adminEmail: requireEnv('ADMIN_EMAIL', 'admin@example.com'),
      adminPassword: requireEnv('ADMIN_PASSWORD', 'change-this-password'),
      accessApiKey: process.env.ACCESS_API_KEY || undefined,
    },

    storage: {
      s3Bucket: process.env.AWS_S3_BUCKET || undefined,
      // 'local' is the correct default for self-hosters (used as S3 object prefix).
      // Note: cloud.appKey uses 'default-app-key' for historical reasons; this
      // section normalises the default to 'local' for all storage consumers.
      appKey: process.env.APP_KEY || 'local',
      parentAppKey: process.env.PARENT_APP_KEY?.trim() || undefined,
      awsRegion: process.env.AWS_REGION || 'us-east-2',
      storageDir: process.env.STORAGE_DIR || path.resolve(process.cwd(), 'insforge-storage'),
      s3AccessKeyId: process.env.S3_ACCESS_KEY_ID || undefined,
      s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY || undefined,
      awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID || undefined,
      awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || undefined,
      s3EndpointUrl: process.env.S3_ENDPOINT_URL || undefined,
      awsConfigBucket: process.env.AWS_CONFIG_BUCKET || 'insforge-config',
      awsConfigRegion: process.env.AWS_CONFIG_REGION || 'us-east-2',
    },

    functions: {
      denoRuntimeUrl: process.env.DENO_RUNTIME_URL || 'http://localhost:7133',
    },

    deployments: {
      vercelToken: process.env.VERCEL_TOKEN || undefined,
      vercelTeamId: process.env.VERCEL_TEAM_ID || undefined,
      vercelProjectId: process.env.VERCEL_PROJECT_ID || undefined,
      maxDeploymentFiles: parseEnvInt(process.env.MAX_DEPLOYMENT_FILES, 5000),
      maxDeploymentTotalBytes: parseEnvInt(
        process.env.MAX_DEPLOYMENT_TOTAL_BYTES,
        100 * 1024 * 1024
      ),
      maxDeploymentFileBytes: parseEnvInt(process.env.MAX_DEPLOYMENT_FILE_BYTES, 100 * 1024 * 1024),
    },

    ai: {
      openrouterApiKey: process.env.OPENROUTER_API_KEY || undefined,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// config — module-level singleton consumed by all runtime backend code.
// Import this instead of reading process.env directly.
// ─────────────────────────────────────────────────────────────────────────────

export const config: AppConfig = loadConfig();
