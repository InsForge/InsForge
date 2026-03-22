import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// This file tests ONLY the verifyAiUser middleware.
// AIAccessConfigService is fully mocked here, which is safe because no
// other describe block in this file needs the real implementation.
//
// Keeping this in a separate file from ai-access-config.service.test.ts
// avoids the Vitest vi.mock() hoisting problem: vi.mock() calls are hoisted
// to the top of their containing module, so mixing a mock of
// AIAccessConfigService with tests that import the real class would cause the
// real-class tests to receive the mock silently.
// ---------------------------------------------------------------------------

// Hoisted mock objects — must be declared before any imports.
const { mockAIAccessService } = vi.hoisted(() => ({
  mockAIAccessService: {
    isAnonAiAccessAllowed: vi.fn(),
  },
}));

vi.mock('../../src/services/ai/ai-access-config.service', () => ({
  AIAccessConfigService: {
    getInstance: () => mockAIAccessService,
  },
}));

vi.mock('../../src/infra/security/token.manager', () => ({
  TokenManager: {
    getInstance: () => ({
      verifyToken: vi.fn().mockReturnValue({
        sub: 'user-1',
        email: 'user@example.com',
        role: 'project_user',
      }),
    }),
  },
}));

vi.mock('../../src/services/secrets/secret.service', () => ({
  SecretService: {
    getInstance: () => ({
      verifyApiKey: vi.fn().mockResolvedValue(true),
    }),
  },
}));

vi.mock('../../src/utils/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// Import after mocks are registered.
import { verifyAiUser } from '../../src/api/middlewares/auth';
import { AppError } from '../../src/api/middlewares/error';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeReq(authHeader?: string) {
  return {
    headers: authHeader ? { authorization: authHeader } : {},
    ip: '127.0.0.1',
  };
}

const res = {} as never;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('verifyAiUser middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('when the request uses an anon API key (ik_ prefix)', () => {
    it('passes the request through when allow_anon_ai_access is enabled', async () => {
      mockAIAccessService.isAnonAiAccessAllowed.mockResolvedValue(true);

      const req = makeReq('Bearer ik_abc123def456');
      const next = vi.fn();

      await verifyAiUser(req as never, res, next);

      expect(mockAIAccessService.isAnonAiAccessAllowed).toHaveBeenCalledOnce();
      // next() was called by the downstream verifyApiKey — not with an error
      const calledWithError = next.mock.calls.some((args) => args[0] instanceof Error);
      expect(calledWithError).toBe(false);
    });

    it('calls next with a 403 AppError when allow_anon_ai_access is disabled', async () => {
      mockAIAccessService.isAnonAiAccessAllowed.mockResolvedValue(false);

      const req = makeReq('Bearer ik_abc123def456');
      const next = vi.fn();

      await verifyAiUser(req as never, res, next);

      expect(next).toHaveBeenCalledOnce();
      const err = next.mock.calls[0][0];
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(403);
    });

    it('calls next with the original error when isAnonAiAccessAllowed throws', async () => {
      const dbError = new Error('DB connection lost');
      mockAIAccessService.isAnonAiAccessAllowed.mockRejectedValue(dbError);

      const req = makeReq('Bearer ik_abc123def456');
      const next = vi.fn();

      await verifyAiUser(req as never, res, next);

      expect(next).toHaveBeenCalledWith(dbError);
    });
  });

  describe('when the request uses a JWT bearer token (not an ik_ key)', () => {
    it('allows the request without consulting the anon-access flag', async () => {
      // A realistic-looking JWT (three base64url segments separated by dots)
      const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.SIG';
      const req = makeReq(`Bearer ${jwt}`);
      const next = vi.fn();

      await verifyAiUser(req as never, res, next);

      // isAnonAiAccessAllowed must NOT be called for JWT users
      expect(mockAIAccessService.isAnonAiAccessAllowed).not.toHaveBeenCalled();
    });
  });
});
