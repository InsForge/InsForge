import { betterAuth } from 'better-auth';
import { jwt } from 'better-auth/plugins/jwt';
import { bearer } from 'better-auth/plugins/bearer';
import { Pool } from 'pg';
import { customAuthPlugin } from './custom-auth-plugin';

// Create PostgreSQL pool
const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB || 'insforge',
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'postgres',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

export const auth = betterAuth({
  database: pool,
  basePath: '/api/auth/v2',
  // Trust all origins for OAuth callbacks. This is a temporary solution to allow OAuth callbacks from any origin.
  // in the future we should allow users to specify the allowed origins in the config
  trustedOrigins: ['*'],
  // Use underscore-prefixed table names to match system table convention
  user: {
    modelName: '_user',
  },
  session: {
    modelName: '_session',
  },
  account: {
    modelName: '_account',
  },
  verification: {
    modelName: '_verification',
  },
  jwks: {
    modelName: '_jwks',
  },
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      redirectURI:
        process.env.GOOGLE_REDIRECT_URI || 'http://localhost:7130/api/auth/v2/callback/google',
      enabled: !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET,
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID || '',
      clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
      redirectURI:
        process.env.GITHUB_REDIRECT_URI || 'http://localhost:7130/api/auth/v2/callback/github',
      enabled: !!process.env.GITHUB_CLIENT_ID && !!process.env.GITHUB_CLIENT_SECRET,
    },
  },
  plugins: [
    bearer(),
    customAuthPlugin,
    jwt({
      jwt: {
        expirationTime: '7d', // 7 days like current implementation
        definePayload: ({ user }) => {
          return {
            sub: user.id,
            email: user.email,
            // Default values for all users, admin login will be handled by custom admin plugin
            type: 'user',
            role: 'authenticated',
          };
        },
      },
    }),
  ],
});
