/**
 * Short, non-recoverable form of a secret for logs.
 *
 * Startup logs are shipped to stdout/CloudWatch and served back through the
 * logs API, so a full key printed there outlives the console banner. Keep the
 * prefix that tells the operator which key it is and the last four characters,
 * and nothing else.
 */
export function maskSecretForLog(value: string | undefined | null): string {
  if (!value) {
    return '(unset)';
  }
  if (value.length <= 12) {
    return '***';
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
