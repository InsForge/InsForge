import { beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';

// Set JWT_SECRET for tests if not already set
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'test-secret-key-for-jwt-tokens-min-32-chars';
}

// Clean up test database before each test
beforeEach(async () => {
  const testDataDir = './test-data';
  try {
    await fs.rm(testDataDir, { recursive: true, force: true });
  } catch {
    // Directory might not exist, that's ok
  }
});

// Clean up after all tests
afterEach(async () => {
  const testDataDir = './test-data';
  try {
    await fs.rm(testDataDir, { recursive: true, force: true });
  } catch {
    // Directory might not exist, that's ok
  }
});
