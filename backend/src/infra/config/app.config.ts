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
    cloudFrontUrl: string;
    cloudFrontKeyPairId: string;
    cloudFrontPrivateKey: string;
    projectId: string;
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
}

export const config: AppConfig = {
  app: {
    port: parseInt(process.env.PORT || '3000', 10),
    jwtSecret: process.env.JWT_SECRET || 'your_jwt_secret',
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
    apiToken: process.env.FLY_API_TOKEN || '',
    org: process.env.FLY_ORG || 'insforge',
    domain: process.env.COMPUTE_DOMAIN || '',
  },
};
