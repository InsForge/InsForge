import { describe, expect, it } from 'vitest';
import {
  assertSafeOutboundUrl,
  createOutboundAgents,
  isPrivateNetworkAddress,
  OutboundUrlPolicyError,
  resolveSafeOutboundUrl,
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
    'fec0::1',
    '::ffff:127.0.0.1',
  ])('identifies %s as a private or reserved address', (address) => {
    expect(isPrivateNetworkAddress(address)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '2002:0808:0808::1'])(
    'allows public address %s',
    (address) => {
      expect(isPrivateNetworkAddress(address)).toBe(false);
    }
  );

  it.each(['2002:7f00:1::1', '64:ff9b::7f00:1'])(
    'blocks private address embedded in %s',
    (address) => {
      expect(isPrivateNetworkAddress(address)).toBe(true);
    }
  );

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
      assertSafeOutboundUrl('http://localhost:7130/health', {
        allowedHosts: ['localhost'],
      })
    ).resolves.toBeInstanceOf(URL);
  });

  it('returns the resolved address needed for DNS-pinned schedule execution', async () => {
    const result = await resolveSafeOutboundUrl('http://8.8.8.8:8080/hook');

    expect(result).toMatchObject({
      rawUrl: 'http://8.8.8.8:8080/hook',
      hostname: '8.8.8.8',
      port: 8080,
      addresses: ['8.8.8.8'],
    });
  });

  it('rejects a private address at socket lookup time', async () => {
    const { httpAgent } = createOutboundAgents({
      allowPrivateNetworks: false,
      allowedHosts: [],
    });
    const lookup = httpAgent.options.lookup as unknown as (
      hostname: string,
      options: object,
      callback: (error: Error | null, address?: string, family?: number) => void
    ) => void;

    const lookupError = await new Promise<Error | null>((resolve) => {
      lookup('localhost', {}, (error) => resolve(error));
    });
    expect(lookupError).toBeInstanceOf(Error);
    expect(lookupError?.message).toContain('private or reserved');
  });
});
