import { StorageBucketSchema, TableSchema } from '@insforge/shared-schemas';
import logger from '@/utils/logger.js';
import { StorageService } from '../storage/storage';
import { DatabaseTableService } from '../database/table';
import { DatabaseManager } from '../database/manager';
import { getApiBaseUrl } from '@/utils/environment';

export class AgentAPIDocService {
  private static instance: AgentAPIDocService;

  private constructor() {}

  static getInstance(): AgentAPIDocService {
    if (!AgentAPIDocService.instance) {
      AgentAPIDocService.instance = new AgentAPIDocService();
    }
    return AgentAPIDocService.instance;
  }

  /**
   * Map internal column types to API-friendly type names
   */
  private mapColumnType(type: string): string {
    const typeMap: Record<string, string> = {
      string: 'string',
      datetime: 'date-time string',
      integer: 'integer',
      float: 'number',
      boolean: 'boolean',
      uuid: 'UUID string',
      json: 'object/array',
    };
    return typeMap[type] || type;
  }

  /**
   * Convert table schema to simplified record schema with foreign key descriptions
   */
  private tableToRecordSchema(
    table: TableSchema
  ): Record<string, { type: string; required: boolean; description?: string }> {
    const schema: Record<string, { type: string; required: boolean; description?: string }> = {};

    for (const column of table.columns) {
      const field: { type: string; required: boolean; description?: string } = {
        type: this.mapColumnType(column.type),
        required: !column.isNullable,
      };

      // Add foreign key relationship description
      if (column.foreignKey) {
        const fk = column.foreignKey;
        field.description = `Foreign key reference to ${fk.referenceTable}.${fk.referenceColumn}`;
      }

      schema[column.columnName] = field;
    }

    return schema;
  }

  /**
   * Generate AI-native API documentation
   */
  async generateAgentDocumentation(): Promise<Record<string, unknown>> {
    try {
      // Get fresh metadata from database controller

      const storageService = StorageService.getInstance();
      const storageMetadata = await storageService.getMetadata();
      const tableService = new DatabaseTableService();
      const dbManager = DatabaseManager.getInstance();
      const allTables = await dbManager.getUserTables();

      // Generate table schemas with descriptions
      const tableSchemas: Record<
        string,
        Record<string, { type: string; required: boolean; description?: string }>
      > = {};
      const tableList: string[] = [];

      for (const table of allTables) {
        const tableSchema = await tableService.getTableSchema(table);
        tableSchemas[`${table}RecordSchema`] = this.tableToRecordSchema(tableSchema);
        tableList.push(table);
      }

      // Get storage buckets
      const buckets = storageMetadata.buckets || [];
      const bucketList = buckets.map((bucket: StorageBucketSchema) => bucket.name);

      const document = {
        '<critical>': 'Re-read this documentation at the start of each conversation',
        version: process.env.npm_package_version || '1.0.0',
        baseUrl: getApiBaseUrl(),
        securitySchemes: {
          method: 'bearerToken',
          bearerHeader: 'Authorization',
          bearerFormat: 'Bearer {token}',
        },
        // Authentication API for user management
        authenticationApi: {
          register: {
            method: 'POST',
            path: '/api/auth/users',
            request: {
              requiresAuth: false,
              body: {
                email: 'string - valid email address',
                password: 'string - user password (min 8 characters)',
                name: 'string (optional) - user display name',
              },
            },
            response: {
              success: {
                status: 200,
                body: {
                  user: '{id: string, email: string, name: string | null}',
                  accessToken: 'string - JWT token for authentication',
                },
              },
              error: {
                status: '400 | 409 | 500',
                body: '{error: string, message: string, statusCode: number}',
              },
            },
            example: {
              request: 'POST /api/auth/users',
              body: '{email: "user@example.com", password: "securePassword123", name: "John Doe"}',
              response:
                '{user: {id: "uuid", email: "user@example.com", name: "John Doe"}, accessToken: "eyJ..."}',
            },
          },

          login: {
            method: 'POST',
            path: '/api/auth/sessions',
            request: {
              requiresAuth: false,
              body: {
                email: 'string - user email address',
                password: 'string - user password',
              },
            },
            response: {
              success: {
                status: 200,
                body: {
                  user: '{id: string, email: string, name: string | null}',
                  accessToken: 'string - JWT token for authentication',
                },
              },
              error: {
                status: '401 | 400 | 500',
                body: '{error: string, message: string, statusCode: number}',
              },
            },
            example: {
              request: 'POST /api/auth/sessions',
              body: '{email: "user@example.com", password: "securePassword123"}',
              response:
                '{user: {id: "uuid", email: "user@example.com", name: "John Doe"}, accessToken: "eyJ..."}',
            },
          },

          getCurrentUser: {
            method: 'GET',
            path: '/api/auth/sessions/current',
            request: {
              requiresAuth: true,
              headers: {
                Authorization: 'Bearer {accessToken}',
              },
            },
            response: {
              success: {
                status: 200,
                body: {
                  user: '{id: string, email: string, role: string}',
                },
              },
              error: {
                status: '401 | 500',
                body: '{error: string, message: string, statusCode: number}',
              },
            },
            example: {
              request: 'GET /api/auth/sessions/current',
              headers: 'Authorization: Bearer eyJ...',
              response: '{user: {id: "uuid", email: "user@example.com", role: "user"}}',
            },
          },

          googleOAuth: {
            method: 'GET',
            path: '/api/auth/oauth/google',
            request: {
              requiresAuth: false,
              queryParams: {
                redirect_uri: 'string (optional) - URL to redirect after OAuth completion',
              },
            },
            response: {
              success: {
                status: 200,
                body: {
                  authUrl: 'string - Google OAuth authorization URL',
                },
              },
              error: {
                status: '500',
                body: '{error: string, message: string, statusCode: number}',
              },
            },
            example: {
              request: 'GET /api/auth/oauth/google?redirect_uri=http://localhost:3000/dashboard',
              response: '{authUrl: "https://accounts.google.com/o/oauth2/v2/auth?..."}',
            },
          },

          githubOAuth: {
            method: 'GET',
            path: '/api/auth/oauth/github',
            request: {
              requiresAuth: false,
              queryParams: {
                redirect_uri: 'string (optional) - URL to redirect after OAuth completion',
              },
            },
            response: {
              success: {
                status: 200,
                body: {
                  authUrl: 'string - GitHub OAuth authorization URL',
                },
              },
              error: {
                status: '500',
                body: '{error: string, message: string, statusCode: number}',
              },
            },
            example: {
              request: 'GET /api/auth/oauth/github?redirect_uri=http://localhost:3000/dashboard',
              response: '{authUrl: "https://github.com/login/oauth/authorize?..."}',
            },
          },
        },

        // Universal patterns for all tables
        '<critical-database>':
          'Re-read the tableApi section before implementing database operations',
        tableApi: {
          list: {
            method: 'GET',
            path: '/api/database/records/{tableName}',
            request: {
              params: {
                tableName: 'string - name of the table',
              },
              queryParams: {
                // Pagination
                limit: 'number (default: 100)',
                offset: 'number (default: 0)',
                // Sorting
                order: '{columnName}.asc or {columnName}.desc',
                // Selection
                select: 'comma-separated column names (e.g., id,name,email)',
                // Filtering - PostgREST operators
                '{columnName}=eq.{value}': 'equals (exact match)',
                '{columnName}=neq.{value}': 'not equals',
                '{columnName}=gt.{value}': 'greater than',
                '{columnName}=gte.{value}': 'greater than or equal',
                '{columnName}=lt.{value}': 'less than',
                '{columnName}=lte.{value}': 'less than or equal',
                '{columnName}=like.{pattern}': 'LIKE pattern (use * as wildcard)',
                '{columnName}=ilike.{pattern}': 'case-insensitive LIKE (use * as wildcard)',
                '{columnName}=is.null': 'IS NULL',
                '{columnName}=not.is.null': 'IS NOT NULL',
                '{columnName}=in.({value1},{value2},{value3})':
                  'IN - comma-separated values in parentheses',
              },
            },
            response: {
              success: {
                status: 200,
                body: 'Array<{tableName}RecordSchema>',
              },
              error: {
                status: '400 | 401 | 500',
                body: '{error: string, message: string, statusCode: number}',
              },
            },
            example: {
              request:
                'GET /api/database/records/products?limit=10&offset=0&status=active&order=created_at.desc',
              response: '[{...record1}, {...record2}]',
            },
          },

          getById: {
            method: 'GET',
            path: '/api/database/records/{tableName}?id=eq.{id}',
            request: {
              params: {
                tableName: 'string - name of the table',
              },
              queryParams: {
                'id=eq.{value}': 'string - primary key value (using PostgREST eq operator)',
              },
            },
            response: {
              success: {
                status: 200,
                body: 'Array<{tableName}RecordSchema> (single item array)',
              },
              error: {
                status: '404 | 401 | 500',
                body: '{error: string, message: string, statusCode: number}',
              },
            },
            example: {
              request: 'GET /api/database/records/products?id=eq.123',
              response: '[{id: "123", name: "Product Name", price: 29.99, ...}]',
            },
          },

          create: {
            '<critical-create>':
              'Re-read this create operation documentation before every POST request',
            method: 'POST',
            path: '/api/database/records/{tableName}',
            request: {
              params: {
                tableName: 'string - name of the table',
              },
              body: '[Omit<{tableName}RecordSchema, "id" | "created_at" | "updated_at">] - MUST be array even for single record (exclude the system fields)',
              headers: {
                Prefer:
                  'return=representation (REQUIRED to get created record back, otherwise returns empty array)',
              },
            },
            response: {
              success: {
                status: 201,
                body: 'Array<{tableName}RecordSchema> with Prefer header | [] empty array without',
              },
              error: {
                status: '400 | 401 | 500',
                body: '{error: string, message: string, statusCode: number}',
              },
            },
            example: {
              request: 'POST /api/database/records/products',
              headers: 'Prefer: return=representation',
              body: '[{name: "New Product", price: 29.99, category: "electronics"}]',
              response:
                '[{id: "123", name: "New Product", price: 29.99, category: "electronics", created_at: "...", updated_at: "..."}]',
            },
          },

          update: {
            method: 'PATCH',
            path: '/api/database/records/{tableName}?id=eq.{id}',
            request: {
              params: {
                tableName: 'string - name of the table',
              },
              queryParams: {
                'id=eq.{value}': 'string - primary key value (using PostgREST eq operator)',
              },
              body: 'Partial<{tableName}RecordSchema> (all fields optional, exclude the system fields)',
              headers: {
                Prefer: 'return=representation (optional - to return updated record)',
              },
            },
            response: {
              success: {
                status: 200,
                body: 'Array<{tableName}RecordSchema> (with Prefer: return=representation) | 204 No Content (without)',
              },
              error: {
                status: '404 | 400 | 401 | 500',
                body: '{error: string, message: string, statusCode: number}',
              },
            },
            example: {
              request: 'PATCH /api/database/records/products?id=eq.123',
              headers: 'Prefer: return=representation',
              body: '{price: 39.99}',
              response: '[{id: "123", name: "Product Name", price: 39.99, ...}]',
            },
          },

          delete: {
            method: 'DELETE',
            path: '/api/database/records/{tableName}?id=eq.{id}',
            request: {
              params: {
                tableName: 'string - name of the table',
              },
              queryParams: {
                'id=eq.{value}': 'string - primary key value (using PostgREST eq operator)',
              },
              headers: {
                Prefer: 'return=representation (optional - to return deleted record)',
              },
            },
            response: {
              success: {
                status: 204,
                body: 'null (No Content) | Array<{tableName}RecordSchema> with Prefer: return=representation',
              },
              error: {
                status: '404 | 401 | 500',
                body: '{error: string, message: string, statusCode: number}',
              },
            },
            example: {
              request: 'DELETE /api/database/records/products?id=eq.123',
              response: 'Status: 204',
            },
          },

          bulkUpdate: {
            method: 'PATCH',
            path: '/api/database/records/{tableName}',
            request: {
              params: {
                tableName: 'string - name of the table',
              },
              queryParams: 'Use filters to select records (same as list operation)',
              body: 'Partial<{tableName}RecordSchema>',
            },
            response: {
              success: {
                status: 200,
                body: 'Array<{tableName}RecordSchema>',
              },
              error: {
                status: '400 | 401 | 500',
                body: '{error: string, message: string, statusCode: number}',
              },
            },
            example: {
              request: 'PATCH /api/database/records/products?category=electronics',
              body: '{discount: 10}',
              response: '[{id: "123", name: "Product 1", discount: 10, ...}, ...]',
            },
          },

          bulkDelete: {
            method: 'DELETE',
            path: '/api/database/records/{tableName}',
            request: {
              params: {
                tableName: 'string - name of the table',
              },
              queryParams: 'Use filters to select records (same as list operation)',
            },
            response: {
              success: {
                status: 204,
                body: 'null (No Content)',
              },
              error: {
                status: '400 | 401 | 500',
                body: '{error: string, message: string, statusCode: number}',
              },
            },
            example: {
              request: 'DELETE /api/database/records/products?discontinued=true',
              response: 'Status: 204',
            },
          },
        },

        // Deployment API for deploying static websites
        '<critical-deployment>': 'Re-read deploymentApi section before deploying websites',
        deploymentApi: {
          createDeployment: {
            method: 'POST',
            path: '/api/deployments',
            request: {
              requiresAuth: true,
              body: {
                projectName: 'string - name of the project',
                files:
                  'Array<{path: string, content: string}> - array of files with path and base64 content',
              },
            },
            response: {
              success: {
                status: 201,
                body: {
                  id: 'string - deployment UUID',
                  projectName: 'string',
                  subdomain: 'string - unique subdomain',
                  status: 'string - "active" | "failed"',
                  deploymentUrl: 'string - full URL to deployed site',
                  createdAt: 'datetime string',
                },
              },
              error: {
                status: '400 | 401 | 500',
                body: '{error: string, message: string, statusCode: number}',
              },
            },
            example: {
              request: 'POST /api/deployments',
              body: '{projectName: "my-site", files: [{path: "index.html", content: "PGh0bWw+..."}, {path: "style.css", content: "Ym9keXs..."}]}',
              response:
                '{id: "uuid", projectName: "my-site", subdomain: "my-site-abc123", status: "active", deploymentUrl: "http://localhost:8080/my-site-abc123"}',
            },
          },

          listDeployments: {
            method: 'GET',
            path: '/api/deployments',
            request: {
              requiresAuth: true,
            },
            response: {
              success: {
                status: 200,
                body: 'Array<DeploymentSchema>',
              },
              error: {
                status: '401 | 500',
                body: '{error: string, message: string, statusCode: number}',
              },
            },
            example: {
              request: 'GET /api/deployments',
              response:
                '[{id: "uuid", projectName: "my-site", subdomain: "my-site-abc123", status: "active", deploymentUrl: "..."}]',
            },
          },

          getDeployment: {
            method: 'GET',
            path: '/api/deployments/{id}',
            request: {
              requiresAuth: true,
              params: {
                id: 'string - deployment UUID',
              },
            },
            response: {
              success: {
                status: 200,
                body: 'DeploymentSchema',
              },
              error: {
                status: '404 | 401 | 500',
                body: '{error: string, message: string, statusCode: number}',
              },
            },
            example: {
              request: 'GET /api/deployments/uuid-123',
              response:
                '{id: "uuid-123", projectName: "my-site", subdomain: "my-site-abc123", status: "active", deploymentUrl: "..."}',
            },
          },

          deleteDeployment: {
            method: 'DELETE',
            path: '/api/deployments/{id}',
            request: {
              requiresAuth: true,
              params: {
                id: 'string - deployment UUID',
              },
            },
            response: {
              success: {
                status: 200,
                body: '{message: string}',
              },
              error: {
                status: '404 | 401 | 500',
                body: '{error: string, message: string, statusCode: number}',
              },
            },
            example: {
              request: 'DELETE /api/deployments/uuid-123',
              response: '{message: "Deployment deleted successfully"}',
            },
          },
        },

        // Storage API for file upload and management
        '<critical-storage>': 'Re-read storageApi section before implementing file operations',
        storageApi: {
          uploadObject: {
            method: 'PUT',
            path: '/api/storage/buckets/{bucketName}/objects/{objectKey}',
            request: {
              requiresAuth: 'user',
              params: {
                bucketName: 'string - name of the bucket',
                objectKey:
                  'string - full object key/path (can include folders like "images/photo.jpg")',
              },
              body: 'multipart/form-data with "file" field containing the file data',
              headers: {
                'Content-Type': 'multipart/form-data',
              },
            },
            response: {
              success: {
                status: 201,
                body: 'StorageFileSchema',
              },
              error: {
                status: '400 | 409 | 401 | 500',
                body: '{error: string, message: string, statusCode: number}',
              },
            },
            example: {
              request: 'PUT /api/storage/buckets/uploads/objects/images/profile.jpg',
              formData: 'file: <binary data>',
              response:
                '{key: "images/profile.jpg", bucket: "uploads", size: 2048, mimeType: "image/jpeg", url: "/api/storage/buckets/uploads/objects/images/profile.jpg"}',
            },
          },

          uploadObjectAutoKey: {
            method: 'POST',
            path: '/api/storage/buckets/{bucketName}/objects',
            request: {
              requiresAuth: 'user',
              params: {
                bucketName: 'string - name of the bucket',
              },
              body: 'multipart/form-data with "file" field containing the file data',
              headers: {
                'Content-Type': 'multipart/form-data',
              },
            },
            response: {
              success: {
                status: 201,
                body: 'StorageFileSchema (with auto-generated key)',
              },
              error: {
                status: '404 | 400 | 401 | 500',
                body: '{error: string, message: string, statusCode: number}',
              },
            },
            example: {
              request: 'POST /api/storage/buckets/uploads/objects',
              formData: 'file: <binary data of photo.jpg>',
              response:
                '{key: "photo-1704000000000-abc123.jpg", bucket: "uploads", size: 2048, url: "/api/storage/buckets/uploads/objects/photo-1704000000000-abc123.jpg"}',
            },
          },

          downloadObject: {
            method: 'GET',
            path: '/api/storage/buckets/{bucketName}/objects/{objectKey}',
            request: {
              requiresAuth: 'conditional - required only for private buckets',
              params: {
                bucketName: 'string - name of the bucket',
                objectKey: 'string - full object key/path',
              },
            },
            response: {
              success: {
                status: 200,
                headers: {
                  'Content-Type': 'file MIME type',
                  'Content-Length': 'file size in bytes',
                },
                body: 'Binary file data',
              },
              error: {
                status: '404 | 400 | 401 | 500',
                body: '{error: string, message: string, statusCode: number}',
              },
            },
            example: {
              request: 'GET /api/storage/buckets/uploads/objects/images/profile.jpg',
              response: '<binary image data>',
            },
          },

          deleteObject: {
            method: 'DELETE',
            path: '/api/storage/buckets/{bucketName}/objects/{objectKey}',
            request: {
              requiresAuth: 'user',
              params: {
                bucketName: 'string - name of the bucket',
                objectKey: 'string - full object key/path',
              },
            },
            response: {
              success: {
                status: 200,
                body: '{message: string}',
              },
              error: {
                status: '404 | 400 | 401 | 500',
                body: '{error: string, message: string, statusCode: number}',
              },
            },
            example: {
              request: 'DELETE /api/storage/buckets/uploads/objects/temp/file.tmp',
              response: '{message: "Object deleted successfully"}',
            },
          },
        },
        // Available tables and their schemas
        tables: {
          availableTableNames: tableList,
          schemas: tableSchemas,
          systemFields: {
            '<critical-info>': 'All system fields are auto-managed by InsForge. NEVER change them.',
            id: { type: 'uuid', autoGenerated: true, primary: true },
            created_at: { type: 'datetime', autoGenerated: true },
            updated_at: { type: 'datetime', autoGenerated: true, autoUpdated: true },
          },
        },
        // Storage schemas
        storage: {
          availableBuckets: bucketList,
          schemas: {
            StorageFileSchema: {
              key: { type: 'string', required: true },
              bucket: { type: 'string', required: true },
              size: { type: 'number (bytes)', required: true },
              mimeType: { type: 'string', required: false },
              uploadedAt: { type: 'datetime string', required: true },
              url: {
                type: 'string',
                required: true,
                description: 'Relative path: /api/storage/buckets/{bucket}/objects/{key}',
              },
            },
          },
        },

        // Quick reference for AI
        '<critical-quickref>': 'Re-read quickReference before starting implementation',
        quickReference: {
          authenticationSteps: [
            '1. Register new users with POST /api/auth/users',
            '2. Login existing users with POST /api/auth/sessions',
            '3. Both endpoints return an accessToken for authentication',
            '4. Include token in Authorization header as "Bearer {token}"',
            '5. OAuth login available via Google and GitHub providers',
            '6. Get current user info with GET /api/auth/sessions/current',
          ],
          databaseSteps: [
            '1. Choose a table from tables.availableTableNames',
            '2. Use the tableApi operations with the chosen table name',
            '3. For request body, use tables.schemas.{tableName}RecordSchema',
            '4. Exclude system fields (id, created_at, updated_at) when creating or updating',
            '5. All update operations accept partial schemas (all fields optional)',
            '6. Use query parameters for filtering, sorting, and pagination in list operations',
          ],
          storageSteps: [
            '1. Upload files using PUT (specific key) or POST (auto-generated key)',
            '2. Files are uploaded as multipart/form-data with "file" field',
            '3. Response url field contains relative path to the file',
            '4. Download files using GET with the url path',
            '5. Public buckets allow downloading without authentication',
            '6. Private buckets require authentication for all operations',
            '7. Organize files using key prefixes like "images/", "documents/"',
          ],
          deploymentSteps: [
            '1. Create deployment with POST /api/deployments',
            '2. Provide projectName and files array with path and base64 content',
            '3. Files must include index.html at root level',
            '4. Response includes deploymentUrl to access the deployed site',
            '5. List all deployments with GET /api/deployments',
            '6. Delete deployment with DELETE /api/deployments/{id}',
          ],
          examples: {
            // Authentication examples
            register:
              'POST /api/auth/users with body {email: "user@example.com", password: "password123"}',
            login:
              'POST /api/auth/sessions with body {email: "user@example.com", password: "password123"}',
            getCurrentUser: 'GET /api/auth/sessions/current with Authorization: Bearer {token}',
            googleLogin: 'GET /api/auth/oauth/google?redirect_uri=http://localhost:3000',
            githubLogin: 'GET /api/auth/oauth/github?redirect_uri=http://localhost:3000',
            // Database examples
            listProducts: 'GET /api/database/records/products?limit=10&category=eq.electronics',
            createProduct:
              'POST /api/database/records/products with Prefer: return=representation header and body [{name: "New Product", price: 29.99}]',
            updateProduct:
              'PATCH /api/database/records/products?id=eq.123 with Prefer: return=representation header and body {price: 39.99}',
            deleteProduct: 'DELETE /api/database/records/products?id=eq.123',
            // Storage examples
            uploadFile: 'PUT /api/storage/buckets/uploads/objects/avatar.jpg with FormData file',
            downloadFile: 'GET /api/storage/buckets/uploads/objects/avatar.jpg',
            deleteFile: 'DELETE /api/storage/buckets/uploads/objects/temp/old-file.tmp',
            // Deployment examples
            deployWebsite:
              'POST /api/deployments with body {projectName: "my-site", files: [{path: "index.html", content: "base64..."}]}',
            listDeployments: 'GET /api/deployments',
            deleteDeployment: 'DELETE /api/deployments/uuid-123',
          },
        },
      };

      return document;
    } catch (error) {
      logger.error('Failed to generate agent API documentation', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
