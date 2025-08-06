#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fetch from 'node-fetch';
import { program } from "commander";
import { handleApiResponse, formatSuccessMessage } from './response-handler.js';
import { promises as fs } from 'fs';
import path from 'path';
import { 
  ColumnType,
  CreateTableRequest,
  UpdateTableSchemaRequest,
  createTableRequestSchema,
  updateTableSchemaBase,
  CreateBucketRequest,
  createBucketRequestSchema
} from '@insforge/shared-schemas';

// Parse command line arguments
program
  .option('--api_key <value>', 'API Key');
program.parse(process.argv);
const options = program.opts();
const { api_key } = options;

const GLOBAL_API_KEY = api_key || process.env.API_KEY || '';

// The schemas are now imported directly from shared-schemas

const server = new McpServer({
  name: "insforge-mcp",
  version: "1.0.0"
});

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:7130";

// Helper function to get API key (use global if provided, otherwise require it in tool calls)
const getApiKey = (toolApiKey?: string): string => {
  if (GLOBAL_API_KEY) return GLOBAL_API_KEY;
  if (toolApiKey) return toolApiKey;
  throw new Error('API key is required. Either pass --api_key as command line argument or provide api_key in tool calls.');
};

// Helper function to rdocumentation from backend
const fetchDocumentation = async (docType: string): Promise<string> => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/docs/${docType}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const result = await handleApiResponse(response);
    
    // Traditional REST format - data returned directly as { type, content }
    if (result && typeof result === 'object' && 'content' in result) {
      return result.content;
    }
    
    throw new Error('Invalid response format from documentation endpoint');
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown error occurred";
    throw new Error(`Unable to retrieve ${docType} documentation: ${errMsg}`);
  }
};

// Helper function to fetch insforge-project.md content
const fetchInsforgeProjectContext = async (): Promise<string | null> => {
  try {
    return await fetchDocumentation('project');
  } catch (error) {
    console.error('Failed to fetch insforge-project.md:', error);
    return null;
  }
};

// Helper function to add background context to responses
const addBackgroundContext = async (response: any): Promise<any> => {
  const context = await fetchInsforgeProjectContext();
  if (context && response.content && Array.isArray(response.content)) {
    // Add the background context as a separate text content item
    response.content.push({
      type: "text",
      text: `\n\n---\n🔧 INSFORGE DEVELOPMENT RULES (Auto-loaded):\n${context}`
    });
  }
  return response;
};

// Helper function to preprocess column default values based on type
// This function works with the shared schema column type
const preprocessColumnDefaults = <T extends { defaultValue?: string; type: ColumnType; columnName: string; isNullable: boolean; isUnique: boolean }>(columns: T[]): T[] => {
  return columns.map(col => {
    if (col.defaultValue !== undefined) {
      const isFunction = col.defaultValue.includes('(');
      const isAlreadyQuoted = col.defaultValue.startsWith("'") && col.defaultValue.endsWith("'");
      
      // Handle different column types
      switch(col.type) {
        case ColumnType.STRING:
          // Add quotes for string values that aren't functions or already quoted
          if (!isFunction && !isAlreadyQuoted) {
            col.defaultValue = `'${col.defaultValue}'`;
          }
          break;
          
        case ColumnType.DATETIME:
          // For datetime, use functions like now() or CURRENT_TIMESTAMP
          // If it's not a function and not CURRENT_TIMESTAMP, it's likely an error
          if (!isFunction && col.defaultValue !== 'CURRENT_TIMESTAMP') {
            console.warn(`Warning: datetime default '${col.defaultValue}' may not work. Use 'now()' or 'CURRENT_TIMESTAMP'`);
          }
          break;
          
        case ColumnType.JSON:
          // JSON defaults need to be wrapped in single quotes
          if (!isAlreadyQuoted) {
            col.defaultValue = `'${col.defaultValue}'`;
          }
          break;
          
        // uuid, integer, float, boolean can be used as-is
      }
    }
    return col;
  });
};

// --------------------------------------------------
// Instruction Tools

// Get main instructions for AI agents
server.tool(
  "get-instructions",
  "Instruction Essential backend setup tool. <critical>MANDATORY: You MUST use this tool FIRST before attempting any backend operations. Contains required API endpoints, authentication details, and setup instructions.</critical>",
  {},
  async () => {
    try {
      const content = await fetchDocumentation('instructions');
      const response = { 
        content: [{ 
          type: "text", 
          text: content
        }] 
      };
      return await addBackgroundContext(response);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error occurred";
      const errorResponse = { 
        content: [{ type: "text", text: `Error: ${errMsg}` }] 
      };
      return await addBackgroundContext(errorResponse);
    }
  }
);

server.tool(
  "debug-backend",
  "Debug Insforge backend issues requires this tool. <critical>MANDATORY: Always use this tool FIRST when encountering backend errors, API failures, or backend questions. It will diagnose issues by reading all documentation, verifying current state, and testing with curl.</critical>",
  {},
  async () => {
    try {
      const content = await fetchDocumentation('debug');
      return await addBackgroundContext({ 
        content: [{ 
          type: "text", 
          text: content
        }] 
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error occurred";
      return await addBackgroundContext({ 
        content: [{ type: "text", text: `Error: ${errMsg}` }] 
      });
    }
  }
);

server.tool(
  "get-api-key",
  "Retrieves the API key for the Insforge OSS backend. This is used to authenticate all requests to the backend.",
  {},
  async () => {
    try {
      return await addBackgroundContext({
        content: [{ type: "text", text: `API key: ${getApiKey()}` }]
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error occurred";
      return await addBackgroundContext({ 
        content: [{ type: "text", text: `Error: ${errMsg}` }] 
      });
    }
  }
);

// Get database API documentation  
server.tool(
  "get-db-api",
  "Retrieves documentation for Insforge OSS database CRUD operations, including automatic table creation and smart schema management",
  {},
  async () => {
    try {
      const content = await fetchDocumentation('db-api');
      return await addBackgroundContext({ 
        content: [{ 
          type: "text", 
          text: content
        }] 
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error occurred";
      return await addBackgroundContext({ 
        content: [{ type: "text", text: `Error: ${errMsg}` }] 
      });
    }
  }
);

// Get authentication API documentation
server.tool(
  "get-auth-api",
  "Retrieves documentation for Insforge OSS authentication API, including JWT tokens, project management, and API key generation",
  {},
  async () => {
    try {
      const content = await fetchDocumentation('auth-api');
      return await addBackgroundContext({ 
        content: [{ 
          type: "text", 
          text: content
        }] 
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error occurred";
      return await addBackgroundContext({ 
        content: [{ type: "text", text: `Error: ${errMsg}` }] 
      });
    }
  }
);

// Get storage API documentation
server.tool(
  "get-storage-api",
  "Retrieves documentation for Insforge OSS file storage API, including file uploads, metadata handling, and automatic cleanup",
  {},
  async () => {
    try {
      const content = await fetchDocumentation('storage-api');
      return await addBackgroundContext({ 
        content: [{ 
          type: "text", 
          text: content
        }] 
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error occurred";
      return await addBackgroundContext({ 
        content: [{ type: "text", text: `Error: ${errMsg}` }] 
      });
    }
  }
);

// Download project-specific rules (CLAUDE.md and cursor rules)
server.tool(
  "download-project-rules",
  "Download project-specific rules (CLAUDE.md and cursor rules) <critical>MANDATORY: You MUST use this tool when starting a new project</critical>",
  {},
  async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/docs/project`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const result = await handleApiResponse(response);
      
      // Traditional REST format - data returned directly as { type, content }
      if (result && typeof result === 'object' && 'content' in result) {
        const outputs = [];
        
        // Save as CLAUDE.md
        const claudeMdPath = path.join(process.cwd(), 'CLAUDE.md');
        await fs.writeFile(claudeMdPath, result.content, 'utf-8');
        outputs.push(`✓ Saved CLAUDE.md to: ${claudeMdPath}`);
        
        // Also save as cursor rules (same content works for both)
        const cursorRulesDir = path.join(process.cwd(), '.cursor', 'rules');
        const cursorRulesPath = path.join(cursorRulesDir, 'cursor-rules.mdc');
        
        // Create directory if it doesn't exist
        await fs.mkdir(cursorRulesDir, { recursive: true });
        await fs.writeFile(cursorRulesPath, result.content, 'utf-8');
        outputs.push(`✓ Saved cursor rules to: ${cursorRulesPath}`);
        
        return await addBackgroundContext({
          content: [{
            type: "text",
            text: outputs.join('\n')
          }]
        });
      }
      
      throw new Error('Invalid response format from project rules endpoint');
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error occurred";
      return await addBackgroundContext({
        content: [{
          type: "text",
          text: `Error downloading project rules: ${errMsg}`
        }],
        isError: true
      });
    }
  }
);

// --------------------------------------------------
// Core Database Tools


server.tool(
  "create-table",
  "Create a new table with explicit schema definition",
  {
    ...createTableRequestSchema.shape,
    apiKey: z.string().optional().describe("API key for authentication (optional if provided via --api_key)")
  },
  async ({ apiKey, tableName, columns, rlsEnabled }) => {
    try {
      const actualApiKey = getApiKey(apiKey);
      
      // Preprocess columns to format default values based on type
      const processedColumns = preprocessColumnDefaults(columns);
      
      const requestBody: CreateTableRequest = {
        tableName,
        columns: processedColumns,
        rlsEnabled: rlsEnabled ?? true
      };
      
      const response = await fetch(`${API_BASE_URL}/api/database/tables`, {
        method: 'POST',
        headers: {
          'x-api-key': actualApiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      const result = await handleApiResponse(response);
      
      return await addBackgroundContext({
        content: [{
          type: "text",
          text: formatSuccessMessage('Table created', result)
        }]
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error occurred";
      return await addBackgroundContext({
        content: [{
          type: "text",
          text: `Error creating table: ${errMsg}`
        }],
        isError: true
      });
    }
  }
);

server.tool(
  "delete-table",
  "Permanently deletes a table and all its data",
  {
    apiKey: z.string().optional().describe("API key for authentication (optional if provided via --api_key)"),
    tableName: z.string().describe("Name of the table to delete")
  },
  async ({ apiKey, tableName }) => {
    try {
      const actualApiKey = getApiKey(apiKey);
      const response = await fetch(`${API_BASE_URL}/api/database/tables/${tableName}`, {
        method: 'DELETE',
        headers: {
          'x-api-key': actualApiKey,
          'Content-Type': 'application/json'
        }
      });

      const result = await handleApiResponse(response);
      
      return await addBackgroundContext({
        content: [{
          type: "text",
          text: formatSuccessMessage('Table deleted', result)
        }]
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error occurred";
      return await addBackgroundContext({
        content: [{
          type: "text",
          text: `Error deleting table: ${errMsg}`
        }],
        isError: true
      });
    }
  }
);

server.tool(
  "modify-table",
  "Alters table schema - add, drop, or rename columns",
  {
    apiKey: z.string().optional().describe("API key for authentication (optional if provided via --api_key)"),
    tableName: z.string().describe("Name of the table to modify"),
    ...updateTableSchemaBase.shape
  },
  async ({ apiKey, tableName, addColumns, dropColumns, renameColumns, addFkeyColumns, dropFkeyColumns }) => {
    try {
      const actualApiKey = getApiKey(apiKey);
      const requestBody: UpdateTableSchemaRequest = {};
      
      // Preprocess addColumns to format default values
      if (addColumns) {
        requestBody.addColumns = preprocessColumnDefaults(addColumns);
      }
      
      if (dropColumns) requestBody.dropColumns = dropColumns;
      if (renameColumns) requestBody.renameColumns = renameColumns;
      if (addFkeyColumns) requestBody.addFkeyColumns = addFkeyColumns;
      if (dropFkeyColumns) requestBody.dropFkeyColumns = dropFkeyColumns;

      const response = await fetch(`${API_BASE_URL}/api/database/tables/${tableName}/schema`, {
        method: 'PATCH',
        headers: {
          'x-api-key': actualApiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      const result = await handleApiResponse(response);
      
      return await addBackgroundContext({
        content: [{
          type: "text",
          text: formatSuccessMessage('Table modified', result)
        }]
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error occurred";
      return await addBackgroundContext({
        content: [{
          type: "text",
          text: `Error modifying table: ${errMsg}`
        }],
        isError: true
      });
    }
  }
);

// Get table schema
server.tool(
  "get-table-schema",
  "Returns the schema of a specific table",
  {
    apiKey: z.string().optional().describe("API key for authentication (optional if provided via --api_key)"),
    tableName: z.string().describe("Name of the table")
  },
  async ({ apiKey, tableName }) => {
    try {
      const actualApiKey = getApiKey(apiKey);
      const response = await fetch(`${API_BASE_URL}/api/database/tables/${tableName}/schema`, {
        method: 'GET',
        headers: {
          'x-api-key': actualApiKey
        }
      });

      const result = await handleApiResponse(response);
      
      return await addBackgroundContext({
        content: [{
          type: "text",
          text: formatSuccessMessage('Schema retrieved', result)
        }]
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error occurred";
      return await addBackgroundContext({
        content: [{
          type: "text",
          text: `Error getting table schema: ${errMsg}`
        }],
        isError: true
      });
    }
  }
);

server.tool(
  "get-backend-metadata",
  "Index all backend metadata",
  {
    apiKey: z.string().optional().describe("API key for authentication (optional if provided via --api_key)")
  },
  async ({ apiKey }) => {
    try {
      const actualApiKey = getApiKey(apiKey);
      const response = await fetch(`${API_BASE_URL}/api/metadata`, {
        method: 'GET',
        headers: {
          'x-api-key': actualApiKey
        }
      });

      const metadata = await handleApiResponse(response);
      
      return await addBackgroundContext({
        content: [{
          type: "text",
          text: `Backend metadata:\n\n${JSON.stringify(metadata, null, 2)}`
        }]
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error occurred";
      return await addBackgroundContext({
        content: [{
          type: "text",
          text: `Error retrieving backend metadata: ${errMsg}`
        }],
        isError: true
      });
    }
  }
);

// --------------------------------------------------
// Storage Tools

// Create storage bucket
server.tool(
  "create-bucket",
  "Create new storage bucket",
  {
    apiKey: z.string().optional().describe("API key for authentication (optional if provided via --api_key)"),
    ...createBucketRequestSchema.shape
  },
  async ({ apiKey, bucketName, isPublic }) => {
    try {
      const actualApiKey = getApiKey(apiKey);
      const response = await fetch(`${API_BASE_URL}/api/storage/buckets`, {
        method: 'POST',
        headers: {
          'x-api-key': actualApiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ bucketName, isPublic } as CreateBucketRequest)
      });

      const result = await handleApiResponse(response);
      
      return await addBackgroundContext({
        content: [{
          type: "text",
          text: formatSuccessMessage('Bucket created', result)
        }]
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error occurred";
      return await addBackgroundContext({
        content: [{
          type: "text",
          text: `Error creating bucket: ${errMsg}`
        }],
        isError: true
      });
    }
  }
);

// List storage buckets
server.tool(
  "list-buckets",
  "Lists all storage buckets",
  {},
  async () => {
    try {
      // This endpoint doesn't require authentication in the current implementation
      const response = await fetch(`${API_BASE_URL}/api/storage/buckets`, {
        method: 'GET',
        headers: {
          'x-api-key': getApiKey() // Still need API key for protected endpoint
        }
      });

      const result = await handleApiResponse(response);
      
      return await addBackgroundContext({
        content: [{
          type: "text",
          text: formatSuccessMessage('Buckets retrieved', result)
        }]
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error occurred";
      return await addBackgroundContext({
        content: [{
          type: "text",
          text: `Error listing buckets: ${errMsg}`
        }],
        isError: true
      });
    }
  }
);

// Delete storage bucket
server.tool(
  "delete-bucket",
  "Deletes a storage bucket",
  {
    apiKey: z.string().optional().describe("API key for authentication (optional if provided via --api_key)"),
    bucketName: z.string().describe("Name of the bucket to delete")
  },
  async ({ apiKey, bucketName }) => {
    try {
      const actualApiKey = getApiKey(apiKey);
      const response = await fetch(`${API_BASE_URL}/api/storage/buckets/${bucketName}`, {
        method: 'DELETE',
        headers: {
          'x-api-key': actualApiKey
        }
      });

      const result = await handleApiResponse(response);
      
      return await addBackgroundContext({
        content: [{
          type: "text",
          text: formatSuccessMessage('Bucket deleted', result)
        }]
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error occurred";
      return await addBackgroundContext({
        content: [{
          type: "text",
          text: `Error deleting bucket: ${errMsg}`
        }],
        isError: true
      });
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Insforge MCP server started");
}

main().catch(console.error);