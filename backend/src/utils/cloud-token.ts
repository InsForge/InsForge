import { createRemoteJWKSet, JWTPayload, jwtVerify } from 'jose';
import { AppError } from '@/api/middleware/error';
import { ERROR_CODES, NEXT_ACTION } from '@/types/error-constants';

/**
 * Create JWKS instance with caching and timeout configuration
 * The instance will automatically cache keys and handle refetching
 */
const cloudApiHost = process.env.CLOUD_API_HOST || 'https://api.insforge.dev';
const JWKS = createRemoteJWKSet(new URL(`${cloudApiHost}/.well-known/jwks.json`), {
  timeoutDuration: 10000, // 10 second timeout for HTTP requests
  cooldownDuration: 30000, // 30 seconds cooldown after successful fetch
  cacheMaxAge: 600000, // Maximum 10 minutes between refetches
});

/**
 * Helper function to verify cloud backend JWT token
 * Validates JWT tokens from api.insforge.dev using JWKS
 */
export async function verifyCloudToken(
  token: string
): Promise<{ projectId: string; payload: JWTPayload }> {
  try {
    // JWKS handles caching internally, no need to manage it manually
    const { payload } = await jwtVerify(token, JWKS, {
      algorithms: ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512'],
    });

    // Verify project_id matches if configured
    const tokenProjectId = payload['projectId'] as string;
    const expectedProjectId = process.env.PROJECT_ID;

    if (expectedProjectId && tokenProjectId !== expectedProjectId) {
      throw new AppError(
        'Project ID mismatch',
        403,
        ERROR_CODES.AUTH_UNAUTHORIZED,
        NEXT_ACTION.CHECK_TOKEN
      );
    }

    return {
      projectId: tokenProjectId || expectedProjectId || 'local',
      payload,
    };
  } catch (error) {
    // Re-throw AppError as-is
    if (error instanceof AppError) {
      throw error;
    }

    // Wrap other JWT errors
    throw new AppError(
      `Invalid cloud authorization code: ${error instanceof Error ? error.message : 'Unknown error'}`,
      401,
      ERROR_CODES.AUTH_INVALID_CREDENTIALS,
      NEXT_ACTION.CHECK_TOKEN
    );
  }
}
