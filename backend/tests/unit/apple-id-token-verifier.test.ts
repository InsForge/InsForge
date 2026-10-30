import { beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWK } from 'jose';
import { verifyAppleIdToken } from '../../src/providers/oauth/apple.provider.js';

const ISSUER = 'https://appleid.apple.com';
const NATIVE_CLIENT_ID = 'com.example.transcribed';
const NONCE = 'test-native-nonce';
const HASHED_NONCE = createHash('sha256').update(NONCE, 'utf8').digest('hex');

describe('verifyAppleIdToken', () => {
  let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
  let jwk: JWK;

  beforeAll(async () => {
    const keyPair = await generateKeyPair('RS256');
    privateKey = keyPair.privateKey;
    jwk = {
      ...(await exportJWK(keyPair.publicKey)),
      kid: 'apple-test-key',
      alg: 'RS256',
      use: 'sig',
    };
  });

  async function signToken(
    claims: Record<string, unknown> = {},
    options: { issuer?: string; audience?: string; expiresIn?: string } = {}
  ): Promise<string> {
    return new SignJWT({
      email: 'relay@privaterelay.appleid.com',
      email_verified: 'true',
      is_private_email: 'true',
      nonce: HASHED_NONCE,
      ...claims,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'apple-test-key' })
      .setIssuer(options.issuer ?? ISSUER)
      .setSubject('apple-subject')
      .setAudience(options.audience ?? NATIVE_CLIENT_ID)
      .setIssuedAt()
      .setExpirationTime(options.expiresIn ?? '5m')
      .sign(privateKey);
  }

  function localJwks() {
    return createLocalJWKSet({ keys: [jwk] });
  }

  it('verifies Apple claims against a server-owned audience and nonce', async () => {
    const result = await verifyAppleIdToken(await signToken(), localJwks(), {
      audiences: [NATIVE_CLIENT_ID],
      nonce: NONCE,
    });

    expect(result).toEqual({
      sub: 'apple-subject',
      email: 'relay@privaterelay.appleid.com',
      email_verified: true,
      is_private_email: true,
    });
  });

  it('accepts any audience in the configured server allowlist', async () => {
    const token = await signToken({}, { audience: 'com.example.second-app' });

    await expect(
      verifyAppleIdToken(token, localJwks(), {
        audiences: [NATIVE_CLIENT_ID, 'com.example.second-app'],
        nonce: NONCE,
      })
    ).resolves.toMatchObject({ sub: 'apple-subject' });
  });

  it('rejects a caller credential with the wrong audience', async () => {
    await expect(
      verifyAppleIdToken(await signToken(), localJwks(), {
        audiences: ['com.example.attacker'],
        nonce: NONCE,
      })
    ).rejects.toThrow();
  });

  it('rejects a mismatched nonce', async () => {
    await expect(
      verifyAppleIdToken(await signToken(), localJwks(), {
        audiences: [NATIVE_CLIENT_ID],
        nonce: 'different-nonce',
      })
    ).rejects.toThrow('Apple ID token nonce does not match');
  });

  it('requires Apple to receive the SHA-256 hash rather than the raw nonce', async () => {
    const token = await signToken({ nonce: NONCE });

    await expect(
      verifyAppleIdToken(token, localJwks(), {
        audiences: [NATIVE_CLIENT_ID],
        nonce: NONCE,
      })
    ).rejects.toThrow('Apple ID token nonce does not match');
  });

  it('rejects the wrong issuer', async () => {
    const token = await signToken({}, { issuer: 'https://attacker.example' });

    await expect(
      verifyAppleIdToken(token, localJwks(), {
        audiences: [NATIVE_CLIENT_ID],
        nonce: NONCE,
      })
    ).rejects.toThrow();
  });

  it('rejects expired tokens', async () => {
    const token = await signToken({}, { expiresIn: '-1m' });

    await expect(
      verifyAppleIdToken(token, localJwks(), {
        audiences: [NATIVE_CLIENT_ID],
        nonce: NONCE,
      })
    ).rejects.toThrow();
  });

  it('rejects tokens without a subject', async () => {
    const token = await new SignJWT({ nonce: HASHED_NONCE })
      .setProtectedHeader({ alg: 'RS256', kid: 'apple-test-key' })
      .setIssuer(ISSUER)
      .setAudience(NATIVE_CLIENT_ID)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);

    await expect(
      verifyAppleIdToken(token, localJwks(), {
        audiences: [NATIVE_CLIENT_ID],
        nonce: NONCE,
      })
    ).rejects.toThrow('Apple ID token is missing the sub claim');
  });

  it('rejects verification when no trusted audience is configured', async () => {
    await expect(
      verifyAppleIdToken(await signToken(), localJwks(), {
        audiences: [' ', ''],
        nonce: NONCE,
      })
    ).rejects.toThrow('No Apple ID token audiences are configured');
  });
});
