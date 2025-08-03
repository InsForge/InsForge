import { betterAuth } from 'better-auth';
import { jwt } from 'better-auth/plugins/jwt';
import { bearer } from 'better-auth/plugins/bearer';
import { Pool } from 'pg';
import { customAdminPlugin } from './custom-admin-plugin';

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
  emailAndPassword: {
    enabled: true,
  },
  plugins: [
    bearer(),
    customAdminPlugin,
    jwt({
      jwt: {
        expirationTime: '7d', // 7 days like current implementation
        // Standard JWT payload - no role logic here
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
  // We'll add OAuth providers in the next PR
});
