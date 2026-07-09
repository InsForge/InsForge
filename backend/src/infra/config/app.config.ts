import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { parseTrustProxySetting, TrustProxySetting } from '../../utils/trust-proxy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPaths = [
  path.resolve(__dirname, '../../../../.env'),
  path.resolve(__dirname, '../../../.env'),
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../.env'),
];
const envPath = envPaths.find((p) => fs.existsSync(p));
if (envPath) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

export interface AppConfig {
  app: {
    port: number;
    jwtSecret: string;
    apiKey: string;
    logLevel: string;
  };
  cloud: {
    storageBucket: string;
    instanceProfile: string;
    apiHost: string;
    appKey: string;
    cloudFrontUrl: string | undefined;
    cloudFrontKeyPairId: string | undefined;
    cloudFrontPrivateKey: string | undefined;
    projectId: string | undefined;
  };
  denoSubhosting: {
    token: string;
    organizationId: string;
    domain: string;
  };
  fly: {
    apiToken: string;
    org: string;
    domain: string;
  };
  server: {
    maxJsonBodySize: string;
    maxUrlencodedBodySize: string;
    maxFileSize: number | undefined;
    maxFilesPerField: number;
    logsDir: string;
    trustProxy: TrustProxySetting;
  };
  database: {
    host: string;
    port: number;
    name: string;
    user: string;
    password: string;
    dir: string;
    postgrestBaseUrl: string;
  };
  auth: {
    rootAdminUsername: string;
    rootAdminPassword: string;
    accessApiKey: string | undefined;
    accessAnonKey: string | undefined;
  };
  storage: {
    s3Bucket: string | undefined;
    appKey: string;
    parentAppKey: string | undefined;
    awsRegion: string;
    storageDir: string;
    s3AccessKeyId: string | undefined;
    s3SecretAccessKey: string | undefined;
    awsAccessKeyId: string | undefined;
    awsSecretAccessKey: string | undefined;
    s3EndpointUrl: string | undefined;
    s3ForcePathStyle: boolean;
    awsConfigBucket: string;
    awsConfigRegion: string;
    maxS3UploadSize: number;
  };
  functions: {
    denoRuntimeUrl: string;
  };
  deployments: {
    vercelToken: string | undefined;
    vercelTeamId: string | undefined;
    vercelProjectId: string | undefined;
    maxDeploymentFiles: number;
    maxDeploymentTotalBytes: number;
    maxDeploymentFileBytes: number;
  };
  ai: {
    openrouterApiKey: string | undefined;
  };
  marketplace: {
    // URL of the hosted marketplace.json catalog; empty = bundled catalog only
    catalogUrl: string;
  };
  telemetry: {
    disabled: boolean;
  };
}

function parseEnvInt(val: string | undefined, fallback: number): number {
  if (!val) return fallback;
  const parsed = parseInt(val, 10);
  if (isNaN(parsed) || parsed <= 0 || !Number.isSafeInteger(parsed)) {
    return fallback;
  }
  return parsed;
}

function parseEnvBool(val: string | undefined): boolean {
  if (!val) return false;
  return ['1', 'true', 'yes', 'on'].includes(val.trim().toLowerCase());
}

const AWS_MAX_SINGLE_PUT_BYTES = 5 * 1024 * 1024 * 1024;

function parseEnvBytes(val: string | undefined, fallback: number): number {
  if (!val) return fallback;
  if (!/^\d+$/.test(val)) return fallback;
  const parsed = Number(val);
  if (!Number.isFinite(parsed) || !Number.isSafeInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, AWS_MAX_SINGLE_PUT_BYTES);
}

export function loadConfig(): AppConfig {
  const logsDir = process.env.LOGS_DIR || path.join(process.cwd(), 'logs');

  return {
    app: {
      port: parseEnvInt(process.env.PORT, 7130),
      jwtSecret: process.env.JWT_SECRET || '',
      apiKey: process.env.ACCESS_API_KEY || 'your_api_key',
      logLevel: process.env.LOG_LEVEL || 'info',
    },
    cloud: {
      storageBucket: process.env.AWS_S3_BUCKET || 'insforge-test-bucket',
      instanceProfile: process.env.AWS_INSTANCE_PROFILE_NAME || 'insforge-instance-profile',
      apiHost: process.env.CLOUD_API_HOST || 'https://api.insforge.dev',
      projectId: process.env.PROJECT_ID || undefined,
      appKey: process.env.APP_KEY || 'default-app-key',
      cloudFrontUrl: process.env.AWS_CLOUDFRONT_URL || undefined,
      cloudFrontKeyPairId: process.env.AWS_CLOUDFRONT_KEY_PAIR_ID || undefined,
      cloudFrontPrivateKey: process.env.AWS_CLOUDFRONT_PRIVATE_KEY || undefined,
    },
    denoSubhosting: {
      // Deno Deploy (v2) credentials. Renamed from DENO_SUBHOSTING_* so an
      // instance's .env can carry both the legacy Subhosting pair (for older
      // OSS versions) and this pair side by side during the v1→v2 migration.
      token: process.env.DENO_DEPLOY_TOKEN || '',
      organizationId: process.env.DENO_DEPLOY_ORG_ID || '',
      // Public function domain. On Deno v2 this is the CloudFront proxy domain
      // (`function2.insforge.app`) that forwards `{appkey}.function2.insforge.app`
      // → `{appkey}.insforge.deno.net`. Overridable so the cloud control-plane can
      // pin v1 (`functions.insforge.app`) vs v2 per deployment. See
      // docs/deno-subhosting.md §4.1.
      domain: process.env.FUNCTIONS_DOMAIN || 'function2.insforge.app',
    },
    fly: {
      apiToken: process.env.FLY_API_TOKEN || '',
      org: process.env.FLY_ORG || '',
      domain: process.env.COMPUTE_DOMAIN || '',
    },
    server: {
      maxJsonBodySize: process.env.MAX_JSON_BODY_SIZE || '100mb',
      maxUrlencodedBodySize: process.env.MAX_URLENCODED_BODY_SIZE || '10mb',
      maxFileSize: (() => {
        const parsed = parseInt(process.env.MAX_FILE_SIZE || '', 10);
        return isNaN(parsed) || parsed <= 0 ? undefined : parsed;
      })(),
      maxFilesPerField: parseEnvInt(process.env.MAX_FILES_PER_FIELD, 10),
      logsDir,
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
      rootAdminUsername: process.env.ROOT_ADMIN_USERNAME || process.env.ADMIN_EMAIL || '',
      rootAdminPassword: process.env.ROOT_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || '',
      accessApiKey: process.env.ACCESS_API_KEY || undefined,
      accessAnonKey: process.env.ACCESS_ANON_KEY || undefined,
    },
    storage: {
      s3Bucket: process.env.AWS_S3_BUCKET || undefined,
      appKey: process.env.APP_KEY || 'local',
      parentAppKey: process.env.PARENT_APP_KEY?.trim() || undefined,
      awsRegion: process.env.AWS_REGION || 'us-east-2',
      storageDir: process.env.STORAGE_DIR || path.resolve(process.cwd(), 'insforge-storage'),
      s3AccessKeyId: process.env.S3_ACCESS_KEY_ID || undefined,
      s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY || undefined,
      awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID || undefined,
      awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || undefined,
      s3EndpointUrl: process.env.S3_ENDPOINT_URL || undefined,
      // Default true (MinIO etc.). Set S3_FORCE_PATH_STYLE=false for providers
      // that require virtual-hosted-style addressing (Tencent COS, Aliyun OSS).
      s3ForcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
      awsConfigBucket: process.env.AWS_CONFIG_BUCKET || 'insforge-config',
      awsConfigRegion: process.env.AWS_CONFIG_REGION || 'us-east-2',
      maxS3UploadSize: parseEnvBytes(process.env.S3_MAX_OBJECT_SIZE_BYTES, 5 * 1024 * 1024 * 1024),
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
    marketplace: {
      catalogUrl:
        process.env.MARKETPLACE_CATALOG_URL ||
        'https://api.insforge.dev/marketplace/v1/catalog',
    },
    telemetry: {
      disabled: parseEnvBool(process.env.INSFORGE_TELEMETRY_DISABLED),
    },
  };
}

export const appConfig: AppConfig = loadConfig();
