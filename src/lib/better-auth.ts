import { betterAuth } from 'better-auth';
import { jwt } from 'better-auth/plugins/jwt';
import { bearer } from 'better-auth/plugins/bearer';
import { Pool } from 'pg';

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
  user: {
    additionalFields: {
      role: {
        type: 'string',
        required: true,
        defaultValue: 'authenticated',
      },
    },
  },
  plugins: [
    bearer(),
    jwt({
      jwt: {
        expirationTime: '7d', // 7 days like current implementation
        // Custom JWT payload as per requirements
        definePayload: async ({ user }) => {
          return {
            sub: user.id,
            email: user.email,
            // type is for backward compatibility with existing middleware
            type: user.role === 'dashboard_user' ? 'admin' : 'user',
            // role is the PostgreSQL role for PostgREST and RLS
            role: user.role || 'authenticated',
          };
        },
      },
    }),
  ],
  // We'll add OAuth providers in the next PR
});