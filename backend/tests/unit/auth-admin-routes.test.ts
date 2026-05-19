import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('admin auth route review regressions', () => {
  const adminRoutesSource = readFileSync(
    resolve(__dirname, '../../src/api/routes/auth/admin.routes.ts'),
    'utf-8'
  );
  const authRouteSources = [
    adminRoutesSource,
    readFileSync(resolve(__dirname, '../../src/api/routes/auth/index.routes.ts'), 'utf-8'),
    readFileSync(resolve(__dirname, '../../src/api/routes/auth/oauth.routes.ts'), 'utf-8'),
  ];

  it('returns a generic server error for unexpected authorization-code exchange failures', () => {
    expect(adminRoutesSource).toContain(
      "logger.error('[Auth:AdminSessionExchange] Failed to exchange admin session'"
    );
    expect(adminRoutesSource).toContain('ERROR_CODES.INTERNAL_ERROR');
    expect(adminRoutesSource).not.toContain('error.message');
  });

  it('preserves admin refresh cookies on non-auth transient refresh failures', () => {
    expect(adminRoutesSource).toContain('error instanceof AppError && error.statusCode === 401');
    expect(adminRoutesSource).not.toContain('error.statusCode === 403');
  });

  it('does not decode freshly issued refresh tokens only to derive CSRF tokens', () => {
    for (const source of authRouteSources) {
      expect(source).not.toContain('generateCsrfToken(tokenManager.verifyRefreshToken');
      expect(source).not.toContain('verifyRefreshToken(newRefreshToken)');
      expect(source).not.toContain('generateCsrfToken({');
    }
    expect(authRouteSources.join('\n')).toContain('generateRefreshTokenWithCsrf');
  });
});
