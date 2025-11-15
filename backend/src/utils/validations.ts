import { AppError } from '@/api/middleware/error';
import { ERROR_CODES } from '@/types/error-constants';
import type { AuthConfigSchema } from '@insforge/shared-schemas';

export function validateEmail(email: string) {
  return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email);
}

/**
 * Validates password against authentication configuration requirements
 * @param password - The password to validate
 * @param config - Authentication configuration with password requirements
 * @returns true if password meets all requirements, false otherwise
 */
export function validatePassword(password: string, config: AuthConfigSchema): boolean {
  // Check minimum length
  if (password.length < config.passwordMinLength) {
    return false;
  }

  // Check for number requirement
  if (config.requireNumber && !/\d/.test(password)) {
    return false;
  }

  // Check for lowercase requirement
  if (config.requireLowercase && !/[a-z]/.test(password)) {
    return false;
  }

  // Check for uppercase requirement
  if (config.requireUppercase && !/[A-Z]/.test(password)) {
    return false;
  }

  // Check for special character requirement
  if (config.requireSpecialChar && !/[!@#$%^&*()_+\-=[\]{};\\|,.<>/?]/.test(password)) {
    return false;
  }

  return true;
}

/**
 * Validates PostgreSQL identifier names (tables, columns, etc.)
 * Prevents SQL injection and ensures valid PostgreSQL identifiers
 *
 * Regex breakdown: ^[^"...]+ means entire string must NOT contain:
 * - " (double quotes) - could break SQL queries
 * - \x00-\x1F (ASCII 0-31) - control characters like null, tab, newline
 * - \x7F (ASCII 127) - DEL character
 */
// eslint-disable-next-line no-control-regex
const IDENTIFIER_REGEX = /^[^"\x00-\x1F\x7F]+$/;

/**
 * Validates a PostgreSQL identifier (table name, column name, etc.)
 * @param identifier - The identifier to validate
 * @param type - Type of identifier for error messages (e.g., 'table', 'column')
 * @returns true if valid
 * @throws AppError if invalid
 */
export function validateIdentifier(identifier: string, type: string = 'identifier'): boolean {
  if (!identifier || !identifier.trim()) {
    throw new AppError(
      `Invalid ${type} name: cannot be empty`,
      400,
      ERROR_CODES.DATABASE_VALIDATION_ERROR,
      `Please provide a valid ${type} name`
    );
  }

  if (!IDENTIFIER_REGEX.test(identifier)) {
    throw new AppError(
      `Invalid ${type} name: cannot contain quotes or control characters`,
      400,
      ERROR_CODES.DATABASE_VALIDATION_ERROR,
      `The ${type} name cannot contain double quotes or control characters (tabs, newlines, etc.)`
    );
  }

  return true;
}

/**
 * Validates a PostgreSQL identifier and returns boolean without throwing
 * @param identifier - The identifier to validate
 * @returns true if valid, false if invalid
 */
export function isValidIdentifier(identifier: string): boolean {
  return Boolean(identifier && identifier.trim() && IDENTIFIER_REGEX.test(identifier));
}

/**
 * Validates table name with additional checks
 * @param tableName - The table name to validate
 * @param operation - The operation being performed (optional)
 * @returns true if valid
 * @throws AppError if invalid
 */
export function validateTableName(tableName: string): boolean {
  validateIdentifier(tableName, 'table');

  // Prevent access to all other system tables (starting with _)
  if (tableName.startsWith('_')) {
    throw new AppError(
      'Access to system tables is not allowed',
      403,
      ERROR_CODES.FORBIDDEN,
      'System tables (starting with _) cannot be accessed directly'
    );
  }

  return true;
}

/**
 * Gets a safe error message for identifier validation
 * @param identifier - The identifier that failed validation
 * @param type - Type of identifier
 * @returns Safe error message
 */
export function getIdentifierErrorMessage(identifier: string, type: string = 'identifier'): string {
  if (!identifier || !identifier.trim()) {
    return `Invalid ${type} name: cannot be empty`;
  }
  if (!IDENTIFIER_REGEX.test(identifier)) {
    return `Invalid ${type} name: cannot contain quotes or control characters`;
  }
  return `Invalid ${type} name`;
}

/**
 * Escapes special characters for SQL LIKE patterns.
 * Prevents injection attacks by escaping %, _ and \ characters which have special meaning in SQL LIKE clauses.
 *
 * How it works:
 * - Matches any of: % (wildcard), _ (single char), or \ (escape char)
 * - Replaces with: \% \_ or \\ respectively
 * - This allows literal matching of these characters in LIKE patterns
 *
 * @param text - Text to escape for use in SQL LIKE pattern
 * @returns Escaped text safe for SQL LIKE usage
 * @example escapeSqlLikePattern("test_file%") → "test\_file\%"
 */
export function escapeSqlLikePattern(text: string): string {
  return text.replace(/([%_\\])/g, '\\$1');
}

/**
 * Escapes special regex metacharacters for literal matching in regular expressions.
 * Prevents regex injection by escaping all characters that have special meaning in regex.
 *
 * How it works:
 * - Matches any regex metacharacter: . * + ? ^ $ { } ( ) | [ ] \
 * - Replaces with escaped version (prefixed with \)
 * - This allows creating regex patterns that match these characters literally
 *
 * @param text - Text to escape for use in regex patterns
 * @returns Escaped text safe for regex literal matching
 * @example escapeRegexPattern("test.file(1)") → "test\\.file\\(1\\)"
 */
export function escapeRegexPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
