import crypto from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES, type UserSchema } from '@insforge/shared-schemas';

const mocks = vi.hoisted(() => ({
  mockGetUserSchemaById: vi.fn(),
  mockGenerateAccessToken: vi.fn().mockReturnValue('mock-access-token'),
}));

vi.mock('@/services/auth/auth.service.js', () => ({
  AuthService: {
    getInstance: () => ({
      getUserSchemaById: mocks.mockGetUserSchemaById,
    }),
  },
}));

vi.mock('@/infra/security/token.manager.js', () => ({
  TokenManager: {
    getInstance: () => ({
      generateAccessToken: mocks.mockGenerateAccessToken,
    }),
  },
}));

vi.mock('@/utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import { OAuthPKCEService } from '@/services/auth/oauth-pkce.service.js';

describe('OAuthPKCEService', () => {
  let service: OAuthPKCEService;

  const mockUser: UserSchema = {
    id: 'user-pkce-123',
    email: 'pkce-test@example.com',
    emailConfirmed: true,
    role: 'authenticated',
    profile: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const codeVerifier = 'dBjftJeZ4CVP-m502K_6KAkrWEZKEt_zUksnCG94EdM';
  const validCodeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset singleton instance between tests
    if (service) {
      service.destroy();
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (OAuthPKCEService as any).instance = undefined;
    service = OAuthPKCEService.getInstance();

    mocks.mockGetUserSchemaById.mockResolvedValue(mockUser);
    mocks.mockGenerateAccessToken.mockReturnValue('mock-access-token');
  });

  afterEach(() => {
    if (service) {
      service.destroy();
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (OAuthPKCEService as any).instance = undefined;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('successfully exchanges a valid code with the correct code_verifier', async () => {
    const code = service.createCode({
      userId: mockUser.id,
      provider: 'google',
      codeChallenge: validCodeChallenge,
    });

    const result = await service.exchangeCode(code, codeVerifier);

    expect(result).toEqual({
      user: mockUser,
      accessToken: 'mock-access-token',
    });
    expect(mocks.mockGetUserSchemaById).toHaveBeenCalledWith(mockUser.id);
    expect(mocks.mockGenerateAccessToken).toHaveBeenCalledWith({
      sub: mockUser.id,
      email: mockUser.email,
      role: 'authenticated',
    });
  });

  it('verifies code_challenge using crypto.timingSafeEqual with Buffers', async () => {
    const timingSafeEqualSpy = vi.spyOn(crypto, 'timingSafeEqual');

    const code = service.createCode({
      userId: mockUser.id,
      provider: 'google',
      codeChallenge: validCodeChallenge,
    });

    await service.exchangeCode(code, codeVerifier);

    expect(timingSafeEqualSpy).toHaveBeenCalledTimes(1);
    const [computedBuf, storedBuf] = timingSafeEqualSpy.mock.calls[0];
    expect(Buffer.isBuffer(computedBuf)).toBe(true);
    expect(Buffer.isBuffer(storedBuf)).toBe(true);
    expect(computedBuf.equals(Buffer.from(validCodeChallenge))).toBe(true);
    expect(storedBuf.equals(Buffer.from(validCodeChallenge))).toBe(true);
  });

  it('rejects exchange when the code is not found or already used (single-use token)', async () => {
    const code = service.createCode({
      userId: mockUser.id,
      provider: 'github',
      codeChallenge: validCodeChallenge,
    });

    // First exchange should succeed
    const firstResult = await service.exchangeCode(code, codeVerifier);
    expect(firstResult.accessToken).toBe('mock-access-token');

    // Second exchange with the same code must fail immediately
    await expect(service.exchangeCode(code, codeVerifier)).rejects.toThrow(
      expect.objectContaining({
        message: 'Invalid or expired code',
        statusCode: 400,
        code: ERROR_CODES.INVALID_INPUT,
      })
    );
  });

  it('rejects exchange with a non-existent code', async () => {
    await expect(service.exchangeCode('non-existent-code', codeVerifier)).rejects.toThrow(
      expect.objectContaining({
        message: 'Invalid or expired code',
        statusCode: 400,
        code: ERROR_CODES.INVALID_INPUT,
      })
    );
  });

  it('rejects exchange when the code has expired', async () => {
    vi.useFakeTimers();

    const code = service.createCode({
      userId: mockUser.id,
      provider: 'google',
      codeChallenge: validCodeChallenge,
    });

    // Advance beyond the 5-minute expiry window
    vi.advanceTimersByTime(5 * 60 * 1000 + 1000);

    await expect(service.exchangeCode(code, codeVerifier)).rejects.toThrow(
      expect.objectContaining({
        message: 'Invalid or expired code',
        statusCode: 400,
        code: ERROR_CODES.INVALID_INPUT,
      })
    );
  });

  it('rejects exchange when the code_challenge does not match (wrong length or completely different)', async () => {
    const code = service.createCode({
      userId: mockUser.id,
      provider: 'google',
      codeChallenge: 'completely-different-and-wrong-challenge',
    });

    await expect(service.exchangeCode(code, codeVerifier)).rejects.toThrow(
      expect.objectContaining({
        message: 'PKCE verification failed',
        statusCode: 400,
        code: ERROR_CODES.AUTH_UNAUTHORIZED,
      })
    );
  });

  it('rejects exchange when the code_challenge is a near-miss differing by exactly one character at the end', async () => {
    // Generate a near-miss challenge: same length as correct challenge, last char flipped
    const lastChar = validCodeChallenge[validCodeChallenge.length - 1];
    const modifiedLastChar = lastChar === 'a' ? 'b' : 'a';
    const nearMissChallenge = validCodeChallenge.slice(0, -1) + modifiedLastChar;

    expect(nearMissChallenge.length).toBe(validCodeChallenge.length);
    expect(nearMissChallenge).not.toBe(validCodeChallenge);

    const code = service.createCode({
      userId: mockUser.id,
      provider: 'google',
      codeChallenge: nearMissChallenge,
    });

    await expect(service.exchangeCode(code, codeVerifier)).rejects.toThrow(
      expect.objectContaining({
        message: 'PKCE verification failed',
        statusCode: 400,
        code: ERROR_CODES.AUTH_UNAUTHORIZED,
      })
    );
  });

  it('rejects exchange when the code_challenge is a near-miss differing by exactly one character at the start', async () => {
    // Generate a near-miss challenge: same length as correct challenge, first char flipped
    const firstChar = validCodeChallenge[0];
    const modifiedFirstChar = firstChar === 'a' ? 'b' : 'a';
    const nearMissChallenge = modifiedFirstChar + validCodeChallenge.slice(1);

    expect(nearMissChallenge.length).toBe(validCodeChallenge.length);
    expect(nearMissChallenge).not.toBe(validCodeChallenge);

    const code = service.createCode({
      userId: mockUser.id,
      provider: 'google',
      codeChallenge: nearMissChallenge,
    });

    await expect(service.exchangeCode(code, codeVerifier)).rejects.toThrow(
      expect.objectContaining({
        message: 'PKCE verification failed',
        statusCode: 400,
        code: ERROR_CODES.AUTH_UNAUTHORIZED,
      })
    );
  });

  it('rejects exchange when the code_challenge is a near-miss differing by exactly one character in the middle', async () => {
    const midIndex = Math.floor(validCodeChallenge.length / 2);
    const midChar = validCodeChallenge[midIndex];
    const modifiedMidChar = midChar === 'a' ? 'b' : 'a';
    const nearMissChallenge =
      validCodeChallenge.slice(0, midIndex) +
      modifiedMidChar +
      validCodeChallenge.slice(midIndex + 1);

    expect(nearMissChallenge.length).toBe(validCodeChallenge.length);
    expect(nearMissChallenge).not.toBe(validCodeChallenge);

    const code = service.createCode({
      userId: mockUser.id,
      provider: 'google',
      codeChallenge: nearMissChallenge,
    });

    await expect(service.exchangeCode(code, codeVerifier)).rejects.toThrow(
      expect.objectContaining({
        message: 'PKCE verification failed',
        statusCode: 400,
        code: ERROR_CODES.AUTH_UNAUTHORIZED,
      })
    );
  });

  it('throws 404 AppError if user is not found during PKCE exchange', async () => {
    mocks.mockGetUserSchemaById.mockResolvedValueOnce(null);

    const code = service.createCode({
      userId: 'missing-user',
      provider: 'google',
      codeChallenge: validCodeChallenge,
    });

    await expect(service.exchangeCode(code, codeVerifier)).rejects.toThrow(
      expect.objectContaining({
        message: 'User not found',
        statusCode: 404,
        code: ERROR_CODES.AUTH_USER_NOT_FOUND,
      })
    );
  });
});
