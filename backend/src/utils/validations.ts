import { AppError } from '@/api/middleware/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { BETTER_AUTH_SYSTEM_TABLES } from '@insforge/shared-schemas';

export function validateEmail(email: string) {
  return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email);
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
  if (!identifier || identifier.trim().length === 0) {
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
  return Boolean(identifier && identifier.trim().length > 0 && IDENTIFIER_REGEX.test(identifier));
}

/**
 * Validates table name with additional checks
 * @param tableName - The table name to validate
 * @param operation - The operation being performed (optional)
 * @returns true if valid
 * @throws AppError if invalid
 */
export function validateTableName(tableName: string, operation?: 'READ' | 'WRITE'): boolean {
  validateIdentifier(tableName, 'table');

  // Prevent access to system tables (starting with _)
  if (tableName.startsWith('_')) {
    throw new AppError(
      'Access to system tables is not allowed',
      403,
      ERROR_CODES.FORBIDDEN,
      'System tables (starting with _) cannot be accessed directly'
    );
  }

  // Special handling for Better Auth system tables
  if (BETTER_AUTH_SYSTEM_TABLES.includes(tableName.toLowerCase())) {
    // User table allows read-only access
    if (tableName.toLowerCase() === 'user' && operation === 'READ') {
      return true; // Allow read access to user table
    }
    
    // Provide specific error for write operations on user table
    if (tableName.toLowerCase() === 'user' && operation === 'WRITE') {
      throw new AppError(
        'Cannot modify user table - use Auth API instead',
        403,
        ERROR_CODES.FORBIDDEN,
        'Use /api/auth/v2/* endpoints to create or update users'
      );
    }
    
    // Block all other Better Auth system tables
    throw new AppError(
      'Access to authentication system tables is not allowed',
      403,
      ERROR_CODES.FORBIDDEN,
      'Authentication system tables cannot be accessed directly'
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
  if (!identifier || identifier.trim().length === 0) {
    return `Invalid ${type} name: cannot be empty`;
  }
  if (!IDENTIFIER_REGEX.test(identifier)) {
    return `Invalid ${type} name: cannot contain quotes or control characters`;
  }
  return `Invalid ${type} name`;
}
