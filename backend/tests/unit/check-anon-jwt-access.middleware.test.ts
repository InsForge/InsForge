import { beforeEach, describe, expect, it, vi } from 'vitest';

// AIAccessConfigService is fully mocked here. Kept in its own file so the
// vi.mock() hoist doesn't collide with the real-class import in
// ai-access-config.service.test.ts.

const { mockAIAccessService, mockVerifyToken } = vi.hoisted(() => ({
  mockAIAccessService: {
    isAnonAiAccessAllowed: vi.fn(),
  },
  mockVerifyToken: vi.fn(),
}));

vi.mock('../../src/services/ai/ai-access-config.service', () => ({
  AIAccessConfigService: {
    getInstance: () => mockAIAccessService,
  },
}));

vi.mock('../../src/infra/security/token.manager', () => ({
  TokenManager: {
    getInstance: () => ({
      verifyToken: mockVerifyToken,
    }),
  },
}));

vi.mock('../../src/services/secrets/secret.service', () => ({
  SecretService: {
    getInstance: () => ({
      verifyApiKey: vi.fn(),
    }),
  },
}));

vi.mock('../../src/utils/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { checkAnonJwtAccess } from '../../src/api/middlewares/auth';
import { AppError } from '../../src/api/middlewares/error';

function makeReq(authHeader?: string) {
  return {
    headers: authHeader ? { authorization: authHeader } : {},
    ip: '127.0.0.1',
  };
}

const res = {} as never;
const ANON_JWT = 'eyJhbGciOiJIUzI1NiJ9.anon.sig';
const AUTH_JWT = 'eyJhbGciOiJIUzI1NiJ9.auth.sig';

describe('checkAnonJwtAccess middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('ik_ service-role key', () => {
    it('passes when the flag is on — without consulting the DB', async () => {
      mockAIAccessService.isAnonAiAccessAllowed.mockResolvedValue(true);
      const next = vi.fn();

      await checkAnonJwtAccess(makeReq('Bearer ik_abc123def456') as never, res, next);

      expect(mockAIAccessService.isAnonAiAccessAllowed).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith();
    });

    it('passes when the flag is off — ik_ is admin-equivalent and must not be gated', async () => {
      mockAIAccessService.isAnonAiAccessAllowed.mockResolvedValue(false);
      const next = vi.fn();

      await checkAnonJwtAccess(makeReq('Bearer ik_abc123def456') as never, res, next);

      expect(mockAIAccessService.isAnonAiAccessAllowed).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith();
    });
  });

  describe('anon-role JWT', () => {
    beforeEach(() => {
      mockVerifyToken.mockReturnValue({ role: 'anon' });
    });

    it('passes when the flag is on', async () => {
      mockAIAccessService.isAnonAiAccessAllowed.mockResolvedValue(true);
      const next = vi.fn();

      await checkAnonJwtAccess(makeReq(`Bearer ${ANON_JWT}`) as never, res, next);

      expect(next).toHaveBeenCalledWith();
    });

    it('returns 403 when the flag is off', async () => {
      mockAIAccessService.isAnonAiAccessAllowed.mockResolvedValue(false);
      const next = vi.fn();

      await checkAnonJwtAccess(makeReq(`Bearer ${ANON_JWT}`) as never, res, next);

      const err = next.mock.calls[0][0];
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(403);
    });

    it('propagates DB errors (fails closed — no silent re-enable)', async () => {
      const dbError = new Error('DB connection lost');
      mockAIAccessService.isAnonAiAccessAllowed.mockRejectedValue(dbError);
      const next = vi.fn();

      await checkAnonJwtAccess(makeReq(`Bearer ${ANON_JWT}`) as never, res, next);

      expect(next).toHaveBeenCalledWith(dbError);
    });
  });

  describe('authenticated-role JWT', () => {
    it('passes regardless of flag state', async () => {
      mockVerifyToken.mockReturnValue({ role: 'authenticated' });
      mockAIAccessService.isAnonAiAccessAllowed.mockResolvedValue(false);
      const next = vi.fn();

      await checkAnonJwtAccess(makeReq(`Bearer ${AUTH_JWT}`) as never, res, next);

      expect(mockAIAccessService.isAnonAiAccessAllowed).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith();
    });

    it('passes for project_admin role too', async () => {
      mockVerifyToken.mockReturnValue({ role: 'project_admin' });
      mockAIAccessService.isAnonAiAccessAllowed.mockResolvedValue(false);
      const next = vi.fn();

      await checkAnonJwtAccess(makeReq(`Bearer ${AUTH_JWT}`) as never, res, next);

      expect(mockAIAccessService.isAnonAiAccessAllowed).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith();
    });
  });

  describe('malformed / missing auth', () => {
    it('passes through when no auth header is present — verifyUser handles it', async () => {
      const next = vi.fn();
      await checkAnonJwtAccess(makeReq() as never, res, next);
      expect(next).toHaveBeenCalledWith();
    });

    it('passes through malformed tokens so verifyUser can produce the 401', async () => {
      mockVerifyToken.mockImplementation(() => {
        throw new Error('jwt malformed');
      });
      const next = vi.fn();

      await checkAnonJwtAccess(makeReq(`Bearer ${ANON_JWT}`) as never, res, next);

      expect(mockAIAccessService.isAnonAiAccessAllowed).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith();
    });
  });
});
