import { describe, it, expect, vi } from 'vitest';
import { ERROR_CODES } from '@insforge/shared-schemas';

// Own file: the constructor runs once per module instance, so the empty secret has to
// be in place before the first getInstance() anywhere in the file.
const configMock = {
  cloud: { apiHost: 'https://cloud.test', projectId: 'proj-1' },
  app: { jwtSecret: '', logLevel: 'error' },
  server: { logsDir: '/tmp/insforge-token-manager-test-logs' },
};
vi.mock('@/infra/config/app.config.js', () => ({ config: configMock, appConfig: configMock }));

const { TokenManager } = await import('@/infra/security/token.manager.js');
const { AppError } = await import('@/utils/errors.js');

describe('TokenManager with no JWT_SECRET', () => {
  // Every caller of getInstance() catches with `if (error instanceof AppError) throw
  // error;` and rewrites anything else — a bare Error here surfaced as "Failed to
  // update slug" instead of naming the missing variable.
  it('throws an AppError naming the missing variable', () => {
    expect(() => TokenManager.getInstance()).toThrow(AppError);
    expect(() => TokenManager.getInstance()).toThrow('JWT_SECRET is not configured');
    expect(() => TokenManager.getInstance()).toThrow(
      expect.objectContaining({ code: ERROR_CODES.INTERNAL_ERROR })
    );
  });
});
