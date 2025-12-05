import { z } from 'zod';

export const docTypeSchema = z
  .enum([
    'instructions',
    'db-sdk',
    'storage-sdk',
    'functions-sdk',
    'ai-integration-sdk',
    'auth-components-react',
    'real-time',
  ])
  .describe(
    `
    Documentation type: 
      "instructions" (essential backend setup - use FIRST),
      "db-sdk" (database operations),
      "storage-sdk" (file storage),
      "functions-sdk" (edge functions), "ai-integration-sdk" (AI features),
      "auth-components-react" (authentication components for React+Vite applications),
      "ai-integration-sdk" AI chat and image generation,
      "real-time" Real-time pub/sub (database + client events) via WebSockets
    `
  );

export type DocTypeSchema = z.infer<typeof docTypeSchema>;
