import crypto from 'crypto';
import { ColumnType, type AuthConfigSchema, ERROR_CODES } from '@insforge/shared-schemas';
import { AppError } from '@/utils/errors.js';

/**
 * Generates a user-friendly error message listing all password requirements
 * @param config - Authentication configuration with password requirements
 * @returns A formatted message listing all enabled password requirements
 */
export function getPasswordRequirementsMessage(config: AuthConfigSchema): string {
  const requirements: string[] = [];

  requirements.push(`at least ${config.passwordMinLength} characters long`);

  if (config.requireNumber) {
    requirements.push('at least one number');
  }

  if (config.requireLowercase) {
    requirements.push('at least one lowercase letter');
  }

  if (config.requireUppercase) {
    requirements.push('at least one uppercase letter');
  }

  if (config.requireSpecialChar) {
    requirements.push('at least one special character');
  }

  return `Password must contain ${requirements.join(', ')}`;
}

export const convertSqlTypeToColumnType = (sqlType: string): ColumnType | string => {
  switch (sqlType.toLowerCase()) {
    case 'uuid':
      return ColumnType.UUID;
    case 'timestamptz':
    case 'timestamp with time zone':
      return ColumnType.DATETIME;
    case 'date':
      return ColumnType.DATE;
    case 'integer':
    case 'bigint':
    case 'smallint':
    case 'int':
    case 'int2':
    case 'int4':
    case 'serial':
    case 'serial2':
    case 'serial4':
    case 'serial8':
    case 'smallserial':
    case 'bigserial':
      return ColumnType.INTEGER;
    case 'double precision':
    case 'real':
    case 'numeric':
    case 'float':
    case 'float4':
    case 'float8':
    case 'decimal':
      return ColumnType.FLOAT;
    case 'boolean':
    case 'bool':
      return ColumnType.BOOLEAN;
    case 'json':
    case 'jsonb':
    case 'array':
      return ColumnType.JSON;
    case 'text':
    case 'varchar':
    case 'char':
    case 'character varying':
    case 'character':
      return ColumnType.STRING;
    default:
      return sqlType.slice(0, 8);
  }
};

/**
 * Generate a UUID v4
 * @returns A UUID v4 string
 */
export function generateUUID(): string {
  return crypto.randomUUID();
}

/**
 * Generate a random numeric string of specified length
 * @param length - The length of the numeric string to generate
 * @returns A random string containing only digits (0-9)
 */
export function generateNumericCode(length: number): string {
  // Generate each digit independently
  let result = '';
  for (let i = 0; i < length; i++) {
    result += crypto.randomInt(0, 10).toString();
  }

  return result;
}

/**
 * Generate a cryptographically secure random token
 * @param bytes - Number of random bytes to generate (default: 32)
 * @returns Hex-encoded string (length = bytes * 2 characters)
 * @example
 * generateSecureToken(32) // Returns 64-character hex string (256 bits entropy)
 * generateSecureToken(16) // Returns 32-character hex string (128 bits entropy)
 */
export function generateSecureToken(bytes: number = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

/**
 * Client type for authentication endpoints
 * - web: Browser-based clients (default) - uses httpOnly cookies for refresh tokens
 * - mobile: Mobile app clients - refresh token returned in response body
 * - desktop: Desktop app clients - refresh token returned in response body
 * - server: Trusted server-side clients (SSR/BFF/CLI) - refresh token returned in response body
 */
export type ClientType = 'web' | 'mobile' | 'desktop' | 'server';

export const CLIENT_TYPES: readonly ClientType[] = ['web', 'mobile', 'desktop', 'server'] as const;

/**
 * Parse and validate client_type query parameter.
 * Defaults to 'web' when not provided; throws for unknown values.
 */
export function parseClientType(value: unknown): ClientType {
  if (!value) {
    return 'web';
  }
  if (value === 'mobile' || value === 'desktop' || value === 'server') {
    return value;
  }
  throw new AppError(
    `Invalid client_type: "${value}". Must be one of: ${CLIENT_TYPES.join(', ')}`,
    400,
    ERROR_CODES.INVALID_INPUT
  );
}
