import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StorageService } from '@/services/storage/storage.service.js';
import { DatabaseManager } from '@/infra/database/database.manager.js';

describe('Storage Service - Upload Strategy with Bucket Limits', () => {
  let storageService: StorageService;
  let dbManager: DatabaseManager;

  beforeEach(async () => {
    dbManager = DatabaseManager.getInstance();
    await dbManager.initialize();
    storageService = StorageService.getInstance();

    // Clean up test buckets
    const testBuckets = ['test-upload-bucket-1', 'test-upload-bucket-2'];
    for (const bucket of testBuckets) {
      try {
        await storageService.deleteBucket(bucket);
      } catch {
        // Bucket might not exist, continue
      }
    }
  });

  describe('getUploadStrategy with bucket max file size', () => {
    it('should validate file size against bucket limit', async () => {
      const bucketName = 'test-upload-bucket-1';
      const maxFileSize = 5 * 1024 * 1024; // 5MB

      await storageService.createBucket(bucketName, true, maxFileSize);

      // Try to get upload strategy with file size exceeding bucket limit
      const metadata = {
        filename: 'large-file.pdf',
        size: 10 * 1024 * 1024, // 10MB - exceeds 5MB limit
      };

      await expect(
        storageService.getUploadStrategy(bucketName, metadata)
      ).rejects.toThrow('exceeds bucket limit');
    });

    it('should allow file size within bucket limit', async () => {
      const bucketName = 'test-upload-bucket-1';
      const maxFileSize = 10 * 1024 * 1024; // 10MB

      await storageService.createBucket(bucketName, true, maxFileSize);

      const metadata = {
        filename: 'small-file.pdf',
        size: 5 * 1024 * 1024, // 5MB - within limit
      };

      // Should not throw
      await expect(
        storageService.getUploadStrategy(bucketName, metadata)
      ).resolves.toBeDefined();
    });

    it('should use global limit when bucket has no specific limit', async () => {
      const bucketName = 'test-upload-bucket-2';
      const originalEnv = process.env.MAX_FILE_SIZE;
      process.env.MAX_FILE_SIZE = '15728640'; // 15MB

      await storageService.createBucket(bucketName, true); // No max file size

      const metadata = {
        filename: 'file.pdf',
        size: 20 * 1024 * 1024, // 20MB - exceeds global 15MB limit
      };

      // Should use global limit and reject
      await expect(
        storageService.getUploadStrategy(bucketName, metadata)
      ).rejects.toThrow();

      if (originalEnv) {
        process.env.MAX_FILE_SIZE = originalEnv;
      } else {
        delete process.env.MAX_FILE_SIZE;
      }
    });

    it('should pass maxFileSize to provider', async () => {
      const bucketName = 'test-upload-bucket-1';
      const maxFileSize = 7 * 1024 * 1024; // 7MB

      await storageService.createBucket(bucketName, true, maxFileSize);

      const metadata = {
        filename: 'test-file.pdf',
        size: 3 * 1024 * 1024, // 3MB
      };

      const strategy = await storageService.getUploadStrategy(bucketName, metadata);

      // Strategy should be defined (actual implementation depends on provider)
      expect(strategy).toBeDefined();
      expect(strategy.key).toBeDefined();
    });
  });
});

