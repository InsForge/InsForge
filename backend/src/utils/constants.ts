/**
 * Constants used across the application
 */

// Better Auth system tables that should be hidden from database UI
// Note: 'user' table is intentionally excluded to allow it to be visible for referencing
export const BETTER_AUTH_SYSTEM_TABLES = ['session', 'account', 'verification', 'jwks', 'user'];
