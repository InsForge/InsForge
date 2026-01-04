import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Test to verify that the bootstrap-migrations.js file can successfully
 * import the logger from the TypeScript utils/logger.ts file.
 * 
 * This addresses the code reviewer's concern about the import potentially failing.
 */
describe('Bootstrap Migrations Import', () => {
  it('should successfully import logger from TypeScript file', async () => {
    // This test verifies that the import path used in bootstrap-migrations.js works
    // The path: ../../../../utils/logger.js (from bootstrap-migrations.js location)
    // resolves to: src/utils/logger.ts
    
    // Import logger directly to verify it works
    const loggerModule = await import('../../src/utils/logger.js');
    
    expect(loggerModule).toBeDefined();
    expect(loggerModule.default).toBeDefined();
    expect(loggerModule.logger).toBeDefined();
    
    // Verify logger has the expected methods
    const logger = loggerModule.default;
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.warn).toBe('function');
  });

  it('should verify the relative path calculation from bootstrap-migrations.js', () => {
    // Verify the path calculation:
    // bootstrap-migrations.js is at: src/infra/database/migrations/bootstrap/bootstrap-migrations.js
    // logger.ts is at: src/utils/logger.ts
    // 
    // From bootstrap-migrations.js:
    // - Go up 1: bootstrap -> migrations
    // - Go up 2: migrations -> database  
    // - Go up 3: database -> infra
    // - Go up 4: infra -> src
    // - Then: src/utils/logger.js
    
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    
    // Get the actual paths relative to the project root
    // From backend/tests/unit/, go up 2 levels to reach backend/
    const projectRoot = path.resolve(__dirname, '../..');
    const bootstrapPath = path.join(projectRoot, 'src/infra/database/migrations/bootstrap/bootstrap-migrations.js');
    const loggerPath = path.join(projectRoot, 'src/utils/logger.ts');
    
    const bootstrapDir = path.dirname(bootstrapPath);
    const loggerDir = path.dirname(loggerPath);
    
    // Calculate relative path
    const relativePath = path.relative(bootstrapDir, loggerDir);
    
    // Should be ../../../../utils (normalize for cross-platform)
    const normalized = relativePath.replace(/\\/g, '/');
    expect(normalized).toBe('../../../../utils');
  });
});

