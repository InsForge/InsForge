/**
 * Better Auth system tables that should be hidden from the database UI
 * Note: 'user' table allows read-only API access so other tables can reference it with foreign keys
 */
export const BETTER_AUTH_SYSTEM_TABLES = ['session', 'account', 'verification', 'jwks', 'user'];