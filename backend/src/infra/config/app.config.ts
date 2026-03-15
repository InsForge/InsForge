export interface AppConfig {
  app: {
    port: number;
    jwtSecret: string;
    apiKey: string;
    logLevel: string;
  };
  database: {
    host: string;
    port: number;
    username: string;
    password: string;
    databaseName: string;
  };
  cloud: {
    storageBucket: string;
    instanceProfile: string;
    apiHost: string;
    projectId: string;
    appKey: string;
    cloudFrontUrl: string;
    cloudFrontKeyPairId: string;
    cloudFrontPrivateKey: string;
  };
  denoSubhosting: {
    token: string;
    organizationId: string;
    domain: string;
  };
  email: {
    provider: string;
    smtp: {
      host: string;
      port: number;
      secure: boolean;
      user: string;
      pass: string;
      fromName: string;
      fromEmail: string;
    };
  };
}

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
  email: {
    provider: process.env.EMAIL_PROVIDER || 'cloud',
    smtp: {
      host: process.env.SMTP_HOST || 'localhost',
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASSWORD || '',
      fromName: process.env.SMTP_FROM_NAME || 'InsForge',
      fromEmail: process.env.SMTP_FROM_EMAIL || 'noreply@insforge.local',
    },
  },
};
