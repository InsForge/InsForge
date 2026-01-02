import { z } from 'zod';

export const docTypeSchema = z
  .enum([
    // General
    'instructions',

    // TypeScript SDK
    'db-sdk-typescript',
    'storage-sdk-typescript',
    'functions-sdk-typescript',
    'ai-sdk-typescript',
    'auth-sdk-typescript',
    'realtime-sdk-typescript',
    'auth-components-react',
    'auth-components-nextjs',

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
    'auth-sdk-kotlin',
    'ai-sdk-kotlin',
    'realtime-sdk-kotlin',

    // Flutter SDK
    'db-sdk-flutter',
    'storage-sdk-flutter',
    'auth-sdk-flutter',
    'ai-sdk-flutter',
    'realtime-sdk-flutter',

    // Legacy aliases (for backward compatibility)
    'db-sdk',
    'storage-sdk',
    'functions-sdk',
    'ai-integration-sdk',
    'real-time',
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
      "auth-sdk-kotlin" - Authentication
      "ai-sdk-kotlin" - AI features
      "realtime-sdk-kotlin" - Real-time WebSockets

    Flutter (Cross-platform mobile):
      "db-sdk-flutter" - Database operations
      "storage-sdk-flutter" - File storage
      "auth-sdk-flutter" - Authentication
      "ai-sdk-flutter" - AI features
      "realtime-sdk-flutter" - Real-time WebSockets

    General:
      "instructions" - Essential backend setup (use FIRST)

    Legacy (deprecated, use language-specific versions):
      "db-sdk", "storage-sdk", "functions-sdk", "ai-integration-sdk", "real-time"
    `
  );

export type DocTypeSchema = z.infer<typeof docTypeSchema>;
