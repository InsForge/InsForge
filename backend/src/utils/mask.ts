/**
 * Mask a secret for log output: keep a short recognizable prefix (`ik_`,
 * `anon_` or the first 3 characters) and the last 4 characters.
 * Never log the full value of an API key, anon key or token.
 */
export function maskSecret(value: string | undefined | null): string {
  if (!value) {
    return '****';
  }
  if (value.length <= 12) {
    return '****';
  }
  const underscore = value.indexOf('_');
  const prefix =
    underscore > 0 && underscore <= 8 ? value.slice(0, underscore + 1) : value.slice(0, 3);
  return `${prefix}****${value.slice(-4)}`;
}
