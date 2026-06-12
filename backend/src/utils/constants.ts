/** PostgreSQL data types that should preserve empty strings instead of stripping them. */
export const TEXT_LIKE_DATA_TYPES = new Set(['text', 'character varying', 'character', 'citext']);
