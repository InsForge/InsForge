import { describe, expect, it } from 'vitest';
import {
  assertSafeOutboundUrl,
  isPrivateNetworkAddress,
  OutboundUrlPolicyError,
} from '../../src/infra/network/outbound-url-policy.js';

describe('outbound URL policy', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
  ])('identifies %s as a private or reserved address', (address) => {
    expect(isPrivateNetworkAddress(address)).toBe(true);
  });

  it('rejects non-http protocols and URL credentials', async () => {
    await expect(assertSafeOutboundUrl('file:///etc/passwd')).rejects.toThrow(
      'only http and https are allowed'
    );
    await expect(assertSafeOutboundUrl('https://user:password@example.com')).rejects.toThrow(
      'URL credentials are not allowed'
    );
  });

  it('rejects private literal destinations', async () => {
    await expect(assertSafeOutboundUrl('http://127.0.0.1:7130/health')).rejects.toMatchObject({
      reason: 'private or reserved network address',
    } satisfies Partial<OutboundUrlPolicyError>);
  });

  it('allows explicitly configured private destinations', async () => {
    await expect(
      assertSafeOutboundUrl('http://127.0.0.1:7130/health', { allowPrivateNetworks: true })
    ).resolves.toBeInstanceOf(URL);
  });

  it('allows an explicitly configured host before DNS resolution', async () => {
    await expect(
      assertSafeOutboundUrl('https://internal.example.test/health', {
        allowedHosts: ['internal.example.test'],
      })
    ).resolves.toBeInstanceOf(URL);
  });
});
