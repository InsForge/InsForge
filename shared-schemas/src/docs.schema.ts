import { z } from 'zod';

export const docTypeSchema = z
  .enum([
    'instructions',
    'auth-sdk',
    'db-sdk',
    'storage-sdk',
    'functions-sdk',
    'ai-integration-sdk',
    'auth-components-react',
    'auth-components-nextjs',
    'real-time',
    'deployment',
  ])
  .describe(
    `
    Documentation type:
      "instructions" (essential backend setup - use FIRST),
      "db-sdk" (database operations),
      "storage-sdk" (file storage),
      "functions-sdk" (edge functions),
      "auth-sdk" (direct SDK methods for custom auth flows),
      "auth-components-react" (authentication components for React+Vite applications),
      "auth-components-nextjs" (authentication components for Next.js applications),
      "ai-integration-sdk" (AI features),
      "real-time" (real-time pub/sub through WebSockets),
      "deployment" (deploy frontend applications via MCP tool)
    `
  );

export type DocTypeSchema = z.infer<typeof docTypeSchema>;
