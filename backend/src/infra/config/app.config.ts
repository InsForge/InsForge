/**
 * Application configuration interface
 * Defines the structure for all environment-based configuration values
 */
export interface AppConfig {
  /** Application-level settings */
  app: {
    /** Server port number */
    port: number;
    /** Secret key for JWT token signing */
    jwtSecret: string;
    /** API key for authenticated requests */
    apiKey: string;
    /** Logging level (debug, info, warn, error) */
    logLevel: string;
  };
  /** Database connection settings */
  database: {
    /** Database host address */
    host: string;
    /** Database port number */
    port: number;
    /** Database username */
    username: string;
    /** Database password */
    password: string;
    /** Database name */
    databaseName: string;
  };
  /** Cloud service configuration */
  cloud: {
    /** AWS S3 storage bucket name */
    storageBucket: string;
    /** AWS instance profile name */
    instanceProfile: string;
    /** Cloud API host URL */
    apiHost: string;
    /** Project identifier */
    projectId: string;
    /** Application key */
    appKey: string;
    /** CloudFront distribution URL */
    cloudFrontUrl: string;
    /** CloudFront key pair ID */
    cloudFrontKeyPairId: string;
    /** CloudFront private key */
    cloudFrontPrivateKey: string;
  };
  /** Deno Deploy subhosting configuration */
  denoSubhosting: {
    /** Deno Deploy API token */
    token: string;
    /** Deno organization ID */
    organizationId: string;
    /** Default domain for functions */
    domain: string;
  };
}

/**
 * Application configuration object
 * Loads values from environment variables with sensible defaults for development
 * 
 * @example
 * ```typescript
 * import { config } from './app.config.js';
 * const port = config.app.port;
 * const dbHost = config.database.host;
 * ```
 */
export const config: AppConfig = {
  app: {
    port: parseInt(process.env.PORT || '3000', 10),
    jwtSecret: process.env.JWT_SECRET || 'your_jwt_secret',
    apiKey: process.env.ACCESS_API_KEY || 'your_api_key',
    logLevel: process.env.LOG_LEVEL || 'info',
  },
  database: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    username: process.env.POSTGRES_USERNAME || 'user',
    password: process.env.POSTGRES_PASSWORD || 'password',
    databaseName: process.env.POSTGRES_NAME || 'insforge',
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
};
