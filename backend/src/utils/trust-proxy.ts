const DEFAULT_TRUST_PROXY_HOPS = 2;

export type TrustProxySetting = boolean | number | string;

export function parseTrustProxySetting(value = process.env.TRUST_PROXY): TrustProxySetting {
  if (value === undefined || value.trim() === '') {
    return DEFAULT_TRUST_PROXY_HOPS;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }

  const hopCount = Number(normalized);
  if (Number.isFinite(hopCount)) {
    if (Number.isInteger(hopCount) && hopCount >= 0) {
      return hopCount;
    }

    throw new Error(
      'TRUST_PROXY must be a non-negative integer, boolean, or Express trust proxy string'
    );
  }

  // Express also accepts named/address trust proxy values such as
  // "loopback", "linklocal", "uniquelocal", or comma-separated subnets.
  return value.trim();
}
