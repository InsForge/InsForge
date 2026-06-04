export const ANON_ID = '12345678-1234-5678-90ab-cdef12345678';

/** PostgreSQL data types that should preserve empty strings instead of stripping them. */
export const TEXT_LIKE_DATA_TYPES = new Set(['text', 'character varying', 'character', 'citext']);
