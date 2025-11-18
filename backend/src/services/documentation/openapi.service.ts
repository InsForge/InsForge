import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { TableSchema, ColumnSchema, ColumnType } from '@insforge/shared-schemas';
import logger from '@/utils/logger.js';
import { DatabaseTableService } from '@/services/database/table.service';
import { DatabaseManager } from '@/infra/database/manager';
import { getApiBaseUrl } from '@/utils/environment';

// Extend Zod with OpenAPI functionality
extendZodWithOpenApi(z);

export class OpenAPIService {
  private static instance: OpenAPIService;

  private constructor() {}

  static getInstance(): OpenAPIService {
    if (!OpenAPIService.instance) {
      OpenAPIService.instance = new OpenAPIService();
    }
    return OpenAPIService.instance;
  }

  /**
   * Convert column type to Zod schema
   */
  private columnToZodType(column: ColumnSchema): z.ZodTypeAny {
    let baseType: z.ZodTypeAny;

    switch (column.type) {
      case ColumnType.STRING:
        baseType = z.string();
        break;
      case ColumnType.INTEGER:
        baseType = z.number().int();
        break;
      case ColumnType.FLOAT:
        baseType = z.number();
        break;
      case ColumnType.BOOLEAN:
        baseType = z.boolean();
        break;
      case ColumnType.DATE:
        baseType = z.string().date();
        break;
      case ColumnType.DATETIME:
        baseType = z.string().datetime();
        break;
      case ColumnType.UUID:
        baseType = z.string().uuid();
        break;
      case ColumnType.JSON:
        baseType = z.record(z.unknown());
        break;
      default:
        baseType = z.unknown();
    }

    // Apply nullable/optional modifiers
    if (column.isNullable) {
      baseType = baseType.nullable();
    }

    // Apply default values
    if (column.defaultValue !== undefined) {
      baseType = baseType.optional();
    }

    return baseType;
  }

  /**
   * Generate Zod schema for a table
   */
  private generateTableSchema(table: TableSchema): z.ZodObject<Record<string, z.ZodTypeAny>> {
    const schemaFields: Record<string, z.ZodTypeAny> = {};

    for (const column of table.columns) {
      schemaFields[column.columnName] = this.columnToZodType(column);
    }

    return z.object(schemaFields);
  }

  /**
   * Generate filter schema for query parameters
   */
  private generateFilterSchema(table: TableSchema): z.ZodObject<Record<string, z.ZodTypeAny>> {
    const filterFields: Record<string, z.ZodTypeAny> = {};

    // Standard PostgREST query parameters
    filterFields['select'] = z.string().optional().describe('Columns to select');
    filterFields['order'] = z.string().optional().describe('Column to order by');
    filterFields['limit'] = z.string().optional().describe('Maximum number of rows to return');
    filterFields['offset'] = z.string().optional().describe('Number of rows to skip');

    // Add column-specific filters
    for (const column of table.columns) {
      const columnName = column.columnName;

      // Basic equality filter
      filterFields[columnName] = z.string().optional().describe(`Filter by ${columnName}`);

      // PostgREST operators
      filterFields[`${columnName}.eq`] = z.string().optional().describe(`${columnName} equals`);
      filterFields[`${columnName}.neq`] = z
        .string()
        .optional()
        .describe(`${columnName} not equals`);
      filterFields[`${columnName}.gt`] = z
        .string()
        .optional()
        .describe(`${columnName} greater than`);
      filterFields[`${columnName}.gte`] = z
        .string()
        .optional()
        .describe(`${columnName} greater than or equal`);
      filterFields[`${columnName}.lt`] = z.string().optional().describe(`${columnName} less than`);
      filterFields[`${columnName}.lte`] = z
        .string()
        .optional()
        .describe(`${columnName} less than or equal`);
      filterFields[`${columnName}.like`] = z
        .string()
        .optional()
        .describe(`${columnName} LIKE pattern`);
      filterFields[`${columnName}.ilike`] = z
        .string()
        .optional()
        .describe(`${columnName} ILIKE pattern (case insensitive)`);
      filterFields[`${columnName}.is`] = z
        .string()
        .optional()
        .describe(`${columnName} IS (for null checks)`);
      filterFields[`${columnName}.in`] = z.string().optional().describe(`${columnName} IN list`);
    }

    return z.object(filterFields);
  }

  /**
   * Register authentication endpoints
   */
  private registerAuthenticationEndpoints(registry: OpenAPIRegistry) {
    // User registration endpoint
    registry.registerPath({
      method: 'post',
      path: '/api/auth/users',
      summary: 'Register new user',
      description: 'Create a new user account',
      tags: ['Authentication'],
      request: {
        body: {
          content: {
            'application/json': {
              schema: z
                .object({
                  email: z.string().email().describe('Valid email address'),
                  password: z.string().min(8).describe('User password (min 8 characters)'),
                  name: z.string().optional().describe('User display name'),
                })
                .openapi('UserRegistration'),
            },
          },
        },
      },
      responses: {
        200: {
          description: 'User registered successfully',
          content: {
            'application/json': {
              schema: z
                .object({
                  user: z.object({
                    id: z.string(),
                    email: z.string(),
                    name: z.string().nullable(),
                  }),
                  accessToken: z.string().describe('JWT token for authentication'),
                })
                .openapi('AuthResponse'),
            },
          },
        },
        400: {
          description: 'Invalid request',
        },
        409: {
          description: 'User already exists',
        },
      },
    });

    // User login endpoint
    registry.registerPath({
      method: 'post',
      path: '/api/auth/sessions',
      summary: 'User login',
      description: 'Authenticate user and create session',
      tags: ['Authentication'],
      request: {
        body: {
          content: {
            'application/json': {
              schema: z
                .object({
                  email: z.string().email().describe('User email address'),
                  password: z.string().describe('User password'),
                })
                .openapi('UserLogin'),
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Login successful',
          content: {
            'application/json': {
              schema: z
                .object({
                  user: z.object({
                    id: z.string(),
                    email: z.string(),
                    name: z.string().nullable(),
                  }),
                  accessToken: z.string().describe('JWT token for authentication'),
                })
                .openapi('AuthResponse'),
            },
          },
        },
        401: {
          description: 'Invalid credentials',
        },
        400: {
          description: 'Invalid request',
        },
      },
    });

    // Get current user endpoint
    registry.registerPath({
      method: 'get',
      path: '/api/auth/sessions/current',
      summary: 'Get current user',
      description: 'Get information about the currently authenticated user',
      tags: ['Authentication'],
      security: [{ BearerAuth: [] }],
      responses: {
        200: {
          description: 'Current user information',
          content: {
            'application/json': {
              schema: z
                .object({
                  user: z.object({
                    id: z.string(),
                    email: z.string(),
                    role: z.string(),
                  }),
                })
                .openapi('CurrentUserResponse'),
            },
          },
        },
        401: {
          description: 'Unauthorized',
        },
      },
    });

    // Google OAuth endpoint
    registry.registerPath({
      method: 'get',
      path: '/api/auth/oauth/google',
      summary: 'Google OAuth',
      description: 'Initiate Google OAuth authentication',
      tags: ['Authentication'],
      request: {
        query: z
          .object({
            redirect_uri: z.string().optional().describe('URL to redirect after OAuth completion'),
          })
          .openapi('OAuthRequest'),
      },
      responses: {
        200: {
          description: 'OAuth URL generated',
          content: {
            'application/json': {
              schema: z
                .object({
                  authUrl: z.string().describe('Google OAuth authorization URL'),
                })
                .openapi('OAuthUrlResponse'),
            },
          },
        },
        500: {
          description: 'Internal server error',
        },
      },
    });

    // GitHub OAuth endpoint
    registry.registerPath({
      method: 'get',
      path: '/api/auth/oauth/github',
      summary: 'GitHub OAuth',
      description: 'Initiate GitHub OAuth authentication',
      tags: ['Authentication'],
      request: {
        query: z
          .object({
            redirect_uri: z.string().optional().describe('URL to redirect after OAuth completion'),
          })
          .openapi('OAuthRequest'),
      },
      responses: {
        200: {
          description: 'OAuth URL generated',
          content: {
            'application/json': {
              schema: z
                .object({
                  authUrl: z.string().describe('GitHub OAuth authorization URL'),
                })
                .openapi('OAuthUrlResponse'),
            },
          },
        },
        500: {
          description: 'Internal server error',
        },
      },
    });

    // OAuth callback endpoint
    registry.registerPath({
      method: 'get',
      path: '/api/auth/oauth/{provider}/callback',
      summary: 'OAuth callback',
      description: 'OAuth callback endpoint - handled automatically by OAuth flow',
      tags: ['Authentication'],
      request: {
        params: z
          .object({
            provider: z.enum(['google', 'github']).describe('OAuth provider'),
          })
          .openapi('OAuthProvider'),
        query: z
          .object({
            code: z.string().describe('Authorization code from OAuth provider'),
            state: z.string().describe('State parameter for security'),
            token: z.string().optional().describe('ID token for some flows'),
          })
          .openapi('OAuthCallback'),
      },
      responses: {
        302: {
          description: 'Redirects to redirect_uri with authentication details or error',
        },
      },
    });
  }

  /**
   * Register storage endpoints
   */
  private registerStorageEndpoints(registry: OpenAPIRegistry) {
    // Upload object with specific key
    registry.registerPath({
      method: 'put',
      path: '/api/storage/buckets/{bucketName}/objects/{objectKey}',
      summary: 'Upload object',
      description: 'Upload a file to storage with a specific key',
      tags: ['Storage'],
      security: [{ BearerAuth: [] }],
      request: {
        params: z
          .object({
            bucketName: z.string().describe('Name of the bucket'),
            objectKey: z.string().describe('Full object key/path (e.g., "images/photo.jpg")'),
          })
          .openapi('StorageParams'),
        body: {
          content: {
            'multipart/form-data': {
              schema: z
                .object({
                  file: z.instanceof(File).describe('File to upload'),
                })
                .openapi('FileUpload'),
            },
          },
        },
      },
      responses: {
        201: {
          description: 'File uploaded successfully',
          content: {
            'application/json': {
              schema: z
                .object({
                  key: z.string(),
                  bucket: z.string(),
                  size: z.number(),
                  mimeType: z.string().optional(),
                  uploadedAt: z.string(),
                  url: z.string(),
                })
                .openapi('StorageFile'),
            },
          },
        },
        400: {
          description: 'Bad request',
        },
        401: {
          description: 'Unauthorized',
        },
        409: {
          description: 'Conflict - file already exists',
        },
      },
    });

    // Upload object with auto-generated key
    registry.registerPath({
      method: 'post',
      path: '/api/storage/buckets/{bucketName}/objects',
      summary: 'Upload object with auto-key',
      description: 'Upload a file to storage with an auto-generated key',
      tags: ['Storage'],
      security: [{ BearerAuth: [] }],
      request: {
        params: z
          .object({
            bucketName: z.string().describe('Name of the bucket'),
          })
          .openapi('BucketParam'),
        body: {
          content: {
            'multipart/form-data': {
              schema: z
                .object({
                  file: z.instanceof(File).describe('File to upload'),
                })
                .openapi('FileUpload'),
            },
          },
        },
      },
      responses: {
        201: {
          description: 'File uploaded successfully',
          content: {
            'application/json': {
              schema: z
                .object({
                  key: z.string(),
                  bucket: z.string(),
                  size: z.number(),
                  mimeType: z.string().optional(),
                  uploadedAt: z.string(),
                  url: z.string(),
                })
                .openapi('StorageFile'),
            },
          },
        },
        400: {
          description: 'Bad request',
        },
        401: {
          description: 'Unauthorized',
        },
        404: {
          description: 'Bucket not found',
        },
      },
    });

    // Download object
    registry.registerPath({
      method: 'get',
      path: '/api/storage/buckets/{bucketName}/objects/{objectKey}',
      summary: 'Download object',
      description: 'Download a file from storage',
      tags: ['Storage'],
      request: {
        params: z
          .object({
            bucketName: z.string().describe('Name of the bucket'),
            objectKey: z.string().describe('Full object key/path'),
          })
          .openapi('StorageParams'),
      },
      responses: {
        200: {
          description: 'File content',
          content: {
            'application/octet-stream': {
              schema: z.instanceof(Buffer).describe('Binary file data'),
            },
          },
        },
        404: {
          description: 'File not found',
        },
        401: {
          description: 'Unauthorized (for private buckets)',
        },
      },
    });

    // Delete object
    registry.registerPath({
      method: 'delete',
      path: '/api/storage/buckets/{bucketName}/objects/{objectKey}',
      summary: 'Delete object',
      description: 'Delete a file from storage',
      tags: ['Storage'],
      security: [{ BearerAuth: [] }],
      request: {
        params: z
          .object({
            bucketName: z.string().describe('Name of the bucket'),
            objectKey: z.string().describe('Full object key/path'),
          })
          .openapi('StorageParams'),
      },
      responses: {
        200: {
          description: 'File deleted successfully',
          content: {
            'application/json': {
              schema: z
                .object({
                  message: z.string(),
                })
                .openapi('DeleteResponse'),
            },
          },
        },
        404: {
          description: 'File not found',
        },
        401: {
          description: 'Unauthorized',
        },
      },
    });
  }

  /**
   * Register CRUD endpoints for a table
   */
  private registerTableEndpoints(registry: OpenAPIRegistry, table: TableSchema) {
    const tableName = table.tableName;
    const recordSchema = this.generateTableSchema(table);
    const filterSchema = this.generateFilterSchema(table);

    // Create schemas with OpenAPI metadata
    const singleRecordSchema = recordSchema.openapi(`${tableName}Record`);
    const recordArraySchema = z.array(recordSchema).openapi(`${tableName}RecordArray`);
    const createRecordSchema = recordSchema.partial().openapi(`Create${tableName}Record`);
    const updateRecordSchema = recordSchema.partial().openapi(`Update${tableName}Record`);

    // GET /api/database/records/{tableName} - List records
    registry.registerPath({
      method: 'get',
      path: `/api/database/records/${tableName}`,
      summary: `List ${tableName} records`,
      description: `Retrieve a list of records from the ${tableName} table with optional filtering`,
      tags: [tableName],
      request: {
        query: filterSchema,
      },
      responses: {
        200: {
          description: `List of ${tableName} records`,
          content: {
            'application/json': {
              schema: recordArraySchema,
            },
          },
        },
        400: {
          description: 'Bad request',
        },
        401: {
          description: 'Unauthorized',
        },
      },
    });

    // POST /api/database/records/{tableName} - Create record
    registry.registerPath({
      method: 'post',
      path: `/api/database/records/${tableName}`,
      summary: `Create ${tableName} record`,
      description: `Create a new record in the ${tableName} table`,
      tags: [tableName],
      request: {
        body: {
          content: {
            'application/json': {
              schema: createRecordSchema,
            },
          },
        },
      },
      responses: {
        201: {
          description: `Created ${tableName} record`,
          content: {
            'application/json': {
              schema: singleRecordSchema,
            },
          },
        },
        400: {
          description: 'Bad request',
        },
        401: {
          description: 'Unauthorized',
        },
      },
    });

    // GET /api/database/records/{tableName}/{id} - Get single record
    const primaryKeyColumn = table.columns.find((col) => col.isPrimaryKey);
    if (primaryKeyColumn) {
      registry.registerPath({
        method: 'get',
        path: `/api/database/records/${tableName}/{id}`,
        summary: `Get ${tableName} record by ID`,
        description: `Retrieve a single record from the ${tableName} table by its primary key`,
        tags: [tableName],
        request: {
          params: z.object({
            id: z.string().describe(`Primary key value`),
          }),
        },
        responses: {
          200: {
            description: `${tableName} record`,
            content: {
              'application/json': {
                schema: singleRecordSchema,
              },
            },
          },
          404: {
            description: 'Record not found',
          },
          401: {
            description: 'Unauthorized',
          },
        },
      });

      // PATCH /api/database/records/{tableName}/{id} - Update record
      registry.registerPath({
        method: 'patch',
        path: `/api/database/records/${tableName}/{id}`,
        summary: `Update ${tableName} record`,
        description: `Update a record in the ${tableName} table`,
        tags: [tableName],
        request: {
          params: z.object({
            id: z.string().describe(`Primary key value`),
          }),
          body: {
            content: {
              'application/json': {
                schema: updateRecordSchema,
              },
            },
          },
        },
        responses: {
          200: {
            description: `Updated ${tableName} record`,
            content: {
              'application/json': {
                schema: singleRecordSchema,
              },
            },
          },
          404: {
            description: 'Record not found',
          },
          401: {
            description: 'Unauthorized',
          },
        },
      });

      // DELETE /api/database/records/{tableName}/{id} - Delete record
      registry.registerPath({
        method: 'delete',
        path: `/api/database/records/${tableName}/{id}`,
        summary: `Delete ${tableName} record`,
        description: `Delete a record from the ${tableName} table`,
        tags: [tableName],
        request: {
          params: z.object({
            id: z.string().describe(`Primary key value`),
          }),
        },
        responses: {
          204: {
            description: 'Record deleted successfully',
          },
          404: {
            description: 'Record not found',
          },
          401: {
            description: 'Unauthorized',
          },
        },
      });
    }

    // PATCH /api/database/records/{tableName} - Bulk update
    registry.registerPath({
      method: 'patch',
      path: `/api/database/records/${tableName}`,
      summary: `Bulk update ${tableName} records`,
      description: `Update multiple records in the ${tableName} table based on filters`,
      tags: [tableName],
      request: {
        query: filterSchema,
        body: {
          content: {
            'application/json': {
              schema: updateRecordSchema,
            },
          },
        },
      },
      responses: {
        200: {
          description: `Updated ${tableName} records`,
          content: {
            'application/json': {
              schema: recordArraySchema,
            },
          },
        },
        400: {
          description: 'Bad request',
        },
        401: {
          description: 'Unauthorized',
        },
      },
    });

    // DELETE /api/database/records/{tableName} - Bulk delete
    registry.registerPath({
      method: 'delete',
      path: `/api/database/records/${tableName}`,
      summary: `Bulk delete ${tableName} records`,
      description: `Delete multiple records from the ${tableName} table based on filters`,
      tags: [tableName],
      request: {
        query: filterSchema,
      },
      responses: {
        204: {
          description: 'Records deleted successfully',
        },
        400: {
          description: 'Bad request',
        },
        401: {
          description: 'Unauthorized',
        },
      },
    });
  }

  /**
   * Generate OpenAPI document
   */
  async generateOpenAPIDocument() {
    try {
      // Create new registry
      const registry = new OpenAPIRegistry();

      // Register security scheme
      registry.registerComponent('securitySchemes', 'ApiKeyAuth', {
        type: 'apiKey',
        in: 'header',
        name: 'x-api-key',
        description: 'API key for authentication',
      });

      registry.registerComponent('securitySchemes', 'BearerAuth', {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT token for authentication',
      });

      // Register authentication endpoints
      this.registerAuthenticationEndpoints(registry);

      // Register storage endpoints
      this.registerStorageEndpoints(registry);

      const tableService = new DatabaseTableService();
      const dbManager = DatabaseManager.getInstance();
      const allTables = await dbManager.getUserTables();

      // Register endpoints for each table
      for (const table of allTables) {
        const tableSchema = await tableService.getTableSchema(table);
        this.registerTableEndpoints(registry, tableSchema);
      }

      // Generate OpenAPI document
      const generator = new OpenApiGeneratorV3(registry.definitions);
      const document = generator.generateDocument({
        openapi: '3.0.0',
        info: {
          title: 'InsForge Dynamic API',
          version: process.env.npm_package_version || '1.0.0',
          description: 'Automatically generated API documentation for InsForge database tables',
        },
        servers: [
          {
            url: getApiBaseUrl(),
            description: 'API server',
          },
        ],
        security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
      });

      return document;
    } catch (error) {
      logger.error('Failed to generate OpenAPI document', {
        error: error instanceof Error ? error.message : String(error),
      });
      console.error(error);
      throw error;
    }
  }
}
