import dns from 'node:dns/promises';
import { Agent as HttpAgent, type AgentOptions } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import net from 'node:net';
import { appConfig } from '@/infra/config/app.config.js';

export interface OutboundUrlPolicyOptions {
  allowPrivateNetworks?: boolean;
  allowedHosts?: readonly string[];
}

export class OutboundUrlPolicyError extends Error {
  constructor(
    public readonly reason: string,
    public readonly url: string
  ) {
    super(`Outbound URL rejected: ${reason}`);
    this.name = 'OutboundUrlPolicyError';
  }
}

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^\.+/, '').replace(/\.$/, '');
}

function isAllowedHost(hostname: string, allowedHosts: readonly string[]): boolean {
  const normalized = normalizeHost(hostname);
  return allowedHosts.some((host) => {
    const allowed = normalizeHost(host.trim());
    return allowed !== '' && (normalized === allowed || normalized.endsWith(`.${allowed}`));
  });
}

function parseIpv4(address: string): number[] | null {
  const parts = address.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) {
    return null;
  }

  const octets = parts.map(Number);
  return octets.every((octet) => octet >= 0 && octet <= 255) ? octets : null;
}

function ipv4InRange(octets: number[], start: number[], end: number[]): boolean {
  const value = octets[0] * 2 ** 24 + octets[1] * 2 ** 16 + octets[2] * 2 ** 8 + octets[3];
  const lower = start[0] * 2 ** 24 + start[1] * 2 ** 16 + start[2] * 2 ** 8 + start[3];
  const upper = end[0] * 2 ** 24 + end[1] * 2 ** 16 + end[2] * 2 ** 8 + end[3];
  return value >= lower && value <= upper;
}

function isPrivateIpv4(address: string): boolean {
  const octets = parseIpv4(address);
  if (!octets) return false;

  return (
    octets[0] === 0 ||
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168) ||
    ipv4InRange(octets, [100, 64, 0, 0], [100, 127, 255, 255]) ||
    ipv4InRange(octets, [192, 0, 0, 0], [192, 0, 0, 255]) ||
    ipv4InRange(octets, [192, 0, 2, 0], [192, 0, 2, 255]) ||
    ipv4InRange(octets, [198, 18, 0, 0], [198, 19, 255, 255]) ||
    ipv4InRange(octets, [198, 51, 100, 0], [198, 51, 100, 255]) ||
    ipv4InRange(octets, [203, 0, 113, 0], [203, 0, 113, 255]) ||
    octets[0] >= 224
  );
}

function parseIpv6(address: string): number[] | null {
  const normalized = address.toLowerCase().split('%')[0];
  const halves = normalized.split('::');
  if (halves.length > 2) return null;

  const parseHalf = (half: string): number[] => {
    if (!half) return [];
    const parts = half.split(':');
    const values: number[] = [];
    for (const part of parts) {
      if (part.includes('.')) {
        const octets = parseIpv4(part);
        if (!octets) return [];
        values.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
      } else if (/^[0-9a-f]{1,4}$/.test(part)) {
        values.push(parseInt(part, 16));
      } else {
        return [];
      }
    }
    return values;
  };

  const left = parseHalf(halves[0]);
  const right = halves.length === 2 ? parseHalf(halves[1]) : [];
  if (left.length + right.length > 8 || (halves.length === 1 && left.length !== 8)) return null;
  return [...left, ...Array(8 - left.length - right.length).fill(0), ...right];
}

function ipv6StartsWith(groups: number[], prefix: number[], bits: number): boolean {
  let remaining = bits;
  for (let index = 0; remaining > 0; index++) {
    const width = Math.min(remaining, 16);
    const mask = width === 16 ? 0xffff : 0xffff << (16 - width);
    if ((groups[index] & mask) !== (prefix[index] & mask)) return false;
    remaining -= width;
  }
  return true;
}

function isPrivateIpv6(address: string): boolean {
  const groups = parseIpv6(address);
  if (!groups) return false;

  const isUnspecifiedOrLoopback = groups.every((group, index) =>
    index === 7 ? group <= 1 : group === 0
  );
  return (
    isUnspecifiedOrLoopback ||
    ipv6StartsWith(groups, [0xfc00], 7) ||
    ipv6StartsWith(groups, [0xfe80], 10) ||
    ipv6StartsWith(groups, [0xff00], 8) ||
    ipv6StartsWith(groups, [0x2001, 0xdb8], 32) ||
    (groups.slice(0, 5).every((group) => group === 0) &&
      groups[5] === 0xffff &&
      isPrivateIpv4(`${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`))
  );
}

export function isPrivateNetworkAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^::ffff:/, '');
  if (net.isIPv4(normalized)) return isPrivateIpv4(normalized);
  return net.isIPv6(address) && isPrivateIpv6(address);
}

function validateUrlShape(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new OutboundUrlPolicyError('invalid URL', rawUrl);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new OutboundUrlPolicyError('only http and https are allowed', rawUrl);
  }
  if (parsed.username || parsed.password) {
    throw new OutboundUrlPolicyError('URL credentials are not allowed', rawUrl);
  }
  if (!parsed.hostname) {
    throw new OutboundUrlPolicyError('URL hostname is required', rawUrl);
  }
  return parsed;
}

export async function assertSafeOutboundUrl(
  rawUrl: string,
  options: OutboundUrlPolicyOptions = {}
): Promise<URL> {
  const parsed = validateUrlShape(rawUrl);
  const config = appConfig.outbound;
  const allowPrivateNetworks = options.allowPrivateNetworks ?? config.allowPrivateNetworks;
  const allowedHosts = options.allowedHosts ?? config.allowedHosts;
  const hostname = normalizeHost(parsed.hostname).replace(/^\[|\]$/g, '');

  if (isAllowedHost(hostname, allowedHosts)) return parsed;

  const literalIp = net.isIP(hostname) > 0;
  const addresses = literalIp
    ? [hostname]
    : (await dns.lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);

  if (addresses.length === 0) {
    throw new OutboundUrlPolicyError('hostname did not resolve', rawUrl);
  }
  if (!allowPrivateNetworks && addresses.some(isPrivateNetworkAddress)) {
    throw new OutboundUrlPolicyError('private or reserved network address', rawUrl);
  }

  return parsed;
}

export function getOutboundRequestLimits() {
  return {
    timeoutMs: appConfig.outbound.requestTimeoutMs,
    maxResponseBytes: appConfig.outbound.maxResponseBytes,
    maxRedirects: appConfig.outbound.maxRedirects,
  };
}

export function createOutboundAgents(): {
  httpAgent: HttpAgent;
  httpsAgent: HttpsAgent;
} {
  const allowPrivateNetworks = appConfig.outbound.allowPrivateNetworks;
  const allowedHosts = appConfig.outbound.allowedHosts;
  const lookup: NonNullable<AgentOptions['lookup']> = (hostname, _options, callback) => {
    void dns
      .lookup(hostname, { all: false, verbatim: true })
      .then(({ address, family }) => {
        if (
          !allowPrivateNetworks &&
          !isAllowedHost(hostname, allowedHosts) &&
          isPrivateNetworkAddress(address)
        ) {
          callback(new Error('Outbound hostname resolved to a private or reserved address'), '', 0);
          return;
        }
        callback(null, address, family);
      })
      .catch((error: unknown) => {
        callback(error instanceof Error ? error : new Error(String(error)), '', 0);
      });
  };

  return {
    httpAgent: new HttpAgent({ keepAlive: false, lookup }),
    httpsAgent: new HttpsAgent({ keepAlive: false, lookup }),
  };
}
