// Backend-local remediation guidance returned with selected API errors.
export const NEXT_ACTIONS = {
  // Authentication next actions
  CHECK_TOKEN: 'Check the token is valid or login to get a new token.',
  CHECK_ADMIN_TOKEN: 'Check the admin token is valid or login as admin to get a new token.',
  CHECK_API_KEY: 'Check the API key is valid or generate a new API key.',
  CONFIGURE_EMAIL_PROVIDER:
    'Configure and enable custom SMTP, then retry. Cloud-linked projects can use the managed email provider.',
  RESEND_VERIFICATION_EMAIL:
    'The user account already exists. Retry delivery with POST /api/auth/email/send-verification instead of registering again.',

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

  // RLS / authorization next actions
  CHECK_RLS_POLICY:
    'A row-level security policy denied this operation. Verify the calling user owns the row (uploaded_by / user_id matches the JWT sub), or that an appropriate INSERT/UPDATE/DELETE policy exists for this role.',

  // Compute next actions
  ENABLE_COMPUTE:
    'Compute services are not enabled. Self-hosted: set FLY_API_TOKEN and FLY_ORG in your .env, then restart. Cloud: contact your project admin to enable compute.',
  CHECK_COMPUTE_SERVICE_EXISTS:
    'The compute service was not found. Run `compute list` to see available services.',
  REDEPLOY_COMPUTE_SERVICE:
    'The machine backing this service no longer exists on the compute provider. Redeploy the service (`compute deploy`) to provision a new machine.',
  CHECK_DOCKER_IMAGE:
    'Check the Docker image URL is valid and accessible. Ensure the image exists in the registry.',
  CHECK_FLY_CAPACITY:
    'Compute service deployment failed. Check the Fly.io region has capacity, or try a different region.',
  RETRY_COMPUTE_OPERATION:
    'The operation failed due to a transient error. Wait a moment and try again.',
} as const;

export type NextActionKey = keyof typeof NEXT_ACTIONS;
