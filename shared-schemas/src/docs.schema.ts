import { z } from 'zod';

export const sdkFeatureSchema = z
  .enum(['db', 'storage', 'functions', 'auth', 'ai', 'realtime'])
  .describe(
    `
    SDK feature categories:

    - "db" - Database operations
    - "storage" - File storage
    - "functions" - Edge functions
    - "auth" - User authentication
    - "ai" - AI features
    - "realtime" - Real-time WebSockets
    `
  );

export type SdkFeatureSchema = z.infer<typeof sdkFeatureSchema>;

export const sdkLanguageSchema = z
  .enum([
    'typescript',
    'swift',
    'kotlin',
    // 'flutter',
    'rest-api',
  ])
  .describe(
    `
    SDK languages:

    - "typescript" - JavaScript/TypeScript SDK
    - "swift" - Swift SDK
    - "kotlin" - Kotlin SDK
    - "rest-api" - REST API
    `
  );

export type SdkLanguageSchema = z.infer<typeof sdkLanguageSchema>;

export const docTypeSchema = z
  .enum([
    // General
    'instructions',
    'auth-components-react',
    'auth-components-nextjs',
    'real-time',

    // TypeScript SDK
    'db-sdk-typescript',
    'storage-sdk-typescript',
    'functions-sdk-typescript',
    'ai-sdk-typescript',
    'auth-sdk-typescript',
    'realtime-sdk-typescript',

    // Swift SDK
    'db-sdk-swift',
    'storage-sdk-swift',
    'functions-sdk-swift',
    'auth-sdk-swift',
    'ai-sdk-swift',
    'realtime-sdk-swift',

    // Kotlin SDK
    'db-sdk-kotlin',
    'storage-sdk-kotlin',
    'functions-sdk-kotlin',
    'auth-sdk-kotlin',
    'ai-sdk-kotlin',
    'realtime-sdk-kotlin',

    // Flutter SDK
    // 'db-sdk-flutter',
    // 'storage-sdk-flutter',
    // 'functions-sdk-flutter',
    // 'auth-sdk-flutter',
    // 'ai-sdk-flutter',
    // 'realtime-sdk-flutter',

    // REST API
    'db-rest-api',
    'storage-rest-api',
    'auth-rest-api',
    'functions-rest-api',
    'ai-rest-api',
    'realtime-rest-api',

    // Legacy aliases (for backward compatibility)
    'auth-sdk',
    'db-sdk',
    'storage-sdk',
    'functions-sdk',
    'ai-integration-sdk',
    'realtime-sdk',
  ])
  .describe(
    `
    Documentation type with language suffix:

    TypeScript (Web/Node.js):
      "db-sdk-typescript" - Database operations
      "storage-sdk-typescript" - File storage
      "functions-sdk-typescript" - Edge functions
      "ai-sdk-typescript" - AI features
      "auth-sdk-typescript" - Authentication
      "realtime-sdk-typescript" - Real-time WebSockets
      "auth-components-react" - Auth UI for React+Vite
      "auth-components-nextjs" - Auth UI for Next.js

    Swift (iOS/macOS):
      "db-sdk-swift" - Database operations
      "storage-sdk-swift" - File storage
      "auth-sdk-swift" - Authentication
      "functions-sdk-swift" - Edge functions
      "ai-sdk-swift" - AI features
      "realtime-sdk-swift" - Real-time WebSockets

    Kotlin (Android):
      "db-sdk-kotlin" - Database operations
      "storage-sdk-kotlin" - File storage
      "functions-sdk-kotlin" - Edge functions
      "auth-sdk-kotlin" - Authentication
      "ai-sdk-kotlin" - AI features
      "realtime-sdk-kotlin" - Real-time WebSockets

    REST API:
      "db-rest-api" - Database operations
      "storage-rest-api" - File storage
      "auth-rest-api" - Authentication
      "functions-rest-api" - Edge functions
      "ai-rest-api" - AI features
      "realtime-rest-api" - Real-time WebSockets

    General:
      "instructions" - Essential backend setup (use FIRST)
      "auth-components-react" (authentication components for React+Vite applications),
      "auth-components-nextjs" (authentication components for Next.js applications),
      "real-time" - Real-time pub/sub through WebSockets

    Documentation type:
      "db-sdk" (database operations),
      "storage-sdk" (file storage),
      "functions-sdk" (edge functions),
      "auth-sdk" (direct SDK methods for custom auth flows),
      "ai-integration-sdk" (AI features),
      "realtime-sdk" (real-time pub/sub through WebSockets)
    `
  );

export type DocTypeSchema = z.infer<typeof docTypeSchema>;
