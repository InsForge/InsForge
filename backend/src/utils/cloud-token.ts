import { createRemoteJWKSet, JWTPayload, jwtVerify } from 'jose';
import { AppError } from '@/api/middleware/error';
import { ERROR_CODES, NEXT_ACTION } from '@/types/error-constants';

/**
 * Helper function to verify cloud backend JWT token
 * Validates JWT tokens from api.insforge.dev using JWKS
 */
export async function verifyCloudToken(
  token: string
): Promise<{ projectId: string; payload: JWTPayload }> {
  // Create JWKS endpoint for remote key set
  const JWKS = createRemoteJWKSet(
    new URL((process.env.CLOUD_API_HOST || 'https://api.insforge.dev') + '/.well-known/jwks.json')
  );

  // Verify the token with jose
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
}
