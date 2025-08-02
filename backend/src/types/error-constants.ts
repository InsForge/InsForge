// Common types and constants used across the application

// Error codes - what went wrong
export enum ERROR_CODES {
  // AUTH module
  AUTH_INVALID_EMAIL = 'AUTH_INVALID_EMAIL',
  AUTH_WEAK_PASSWORD = 'AUTH_WEAK_PASSWORD',
  AUTH_INVALID_CREDENTIALS = 'AUTH_INVALID_CREDENTIALS',
  AUTH_INVALID_API_KEY = 'AUTH_INVALID_API_KEY',
  AUTH_EMAIL_EXISTS = 'AUTH_EMAIL_EXISTS',
  AUTH_OAUTH_CONFIG_ERROR = 'AUTH_OAUTH_CONFIG_ERROR',
  AUTH_UNSUPPORTED_PROVIDER = 'AUTH_UNSUPPORTED_PROVIDER',
  AUTH_TOKEN_EXPIRED = 'AUTH_TOKEN_EXPIRED',
  AUTH_UNAUTHORIZED = 'AUTH_UNAUTHORIZED',
  AUTH_NEED_VERIFICATION = 'AUTH_NEED_VERIFICATION',

  // DATABASE module
  DATABASE_INVALID_PARAMETER = 'DATABASE_INVALID_PARAMETER',
  DATABASE_VALIDATION_ERROR = 'DATABASE_VALIDATION_ERROR',
  DATABASE_CONSTRAINT_VIOLATION = 'DATABASE_CONSTRAINT_VIOLATION',
  DATABASE_NOT_FOUND = 'DATABASE_NOT_FOUND',
  DATABASE_DUPLICATE = 'DATABASE_DUPLICATE',
  DATABASE_PERMISSION_DENIED = 'DATABASE_PERMISSION_DENIED',
  DATABASE_INTERNAL_ERROR = 'DATABASE_INTERNAL_ERROR',
  DATABASE_FORBIDDEN = 'DATABASE_FORBIDDEN',

  // STORAGE module
  STORAGE_INVALID_PARAMETER = 'STORAGE_INVALID_PARAMETER',
  STORAGE_INVALID_FILE_TYPE = 'STORAGE_INVALID_FILE_TYPE',
  STORAGE_INSUFFICIENT_QUOTA = 'STORAGE_INSUFFICIENT_QUOTA',
  STORAGE_NOT_FOUND = 'STORAGE_NOT_FOUND',
  STORAGE_PERMISSION_DENIED = 'STORAGE_PERMISSION_DENIED',

  // REALTIME module
  REALTIME_CONNECTION_FAILED = 'REALTIME_CONNECTION_FAILED',
  REALTIME_UNAUTHORIZED = 'REALTIME_UNAUTHORIZED',
  REALTIME_INVALID_EVENT = 'REALTIME_INVALID_EVENT',

  // Billing module
  BILLING_INSUFFICIENT_BALANCE = 'BILLING_INSUFFICIENT_BALANCE',

  // General
  MISSING_FIELD = 'MISSING_FIELD',
  ALREADY_EXISTS = 'ALREADY_EXISTS',
  INVALID_INPUT = 'INVALID_INPUT',
  NOT_FOUND = 'NOT_FOUND',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  TOO_MANY_REQUESTS = 'TOO_MANY_REQUESTS',
  FORBIDDEN = 'FORBIDDEN',
}

// Next actions - what the user should do
export const NEXT_ACTION = {
  // Authentication next actions
  CHECK_TOKEN: 'Check the token is valid or login to get a new token.',
  CHECK_ADMIN_TOKEN: 'Check the admin token is valid or login as admin to get a new token.',
  CHECK_API_KEY: 'Check the API key is valid or generate a new API key.',

  // Database next actions
  CHECK_UNIQUE_FIELD: (field: string) =>
    `A record with this field(${field}) already exists. You can query the existing record by using the query tool and then try again.`,
  CHECK_TABLE_EXISTS:
    'The resource you are trying to access does not exist. Please check the table with get metadata tool and try again.',
  FILL_REQUIRED_FIELD: (field: string) =>
    `The ${field} field is required and cannot be empty. Please fill in a value and try again.`,
  CHECK_REFERENCE_EXISTS:
    'The referenced record does not exist. Please check the reference with get metadata tool and try again.',

  // Schema validation next actions
  CHECK_COLUMN_EXISTS:
    'Check the column name spelling and verify it exists in the table using GET /api/database/tables/{table}/schema',
  CHECK_UNIQUE_CONSTRAINT:
    'Ensure the referenced column has a unique constraint or is a primary key',
  CHECK_DATATYPE_MATCH:
    'Ensure the foreign key column and the referenced column have the same data type.',
  REMOVE_DUPLICATE_COLUMN: (column: string) =>
    `Remove the duplicate "${column}" column definition. Each column name must be unique within a table.`,

  // Add more next actions as needed
} as const;

export type NextActionKey = keyof typeof NEXT_ACTION;
