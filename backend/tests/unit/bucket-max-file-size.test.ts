import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StorageService } from '@/services/storage/storage.service.js';
import { DatabaseManager } from '@/infra/database/database.manager.js';

describe('Bucket Max File Size', () => {
  let storageService: StorageService;
  let dbManager: DatabaseManager;

  beforeEach(async () => {
    // Initialize database manager
    dbManager = DatabaseManager.getInstance();
    await dbManager.initialize();

    // Initialize storage service
    storageService = StorageService.getInstance();

    // Clean up test buckets
    const testBuckets = ['test-bucket-1', 'test-bucket-2', 'test-bucket-3'];
    for (const bucket of testBuckets) {
      try {
        await storageService.deleteBucket(bucket);
      } catch {
        // Bucket might not exist, continue
      }
    }
  });

  describe('createBucket with maxFileSize', () => {
    it('should create bucket with max file size limit', async () => {
      const bucketName = 'test-bucket-1';
      const maxFileSize = 5 * 1024 * 1024; // 5MB

      await storageService.createBucket(bucketName, true, maxFileSize);

      const buckets = await storageService.listBuckets();
      const bucket = buckets.find((b) => b.name === bucketName);
      expect(bucket).toBeDefined();
      expect(bucket?.maxFileSize).toBe(maxFileSize);
    });

    it('should create bucket without max file size (null)', async () => {
      const bucketName = 'test-bucket-2';

      await storageService.createBucket(bucketName, true, null);

      const buckets = await storageService.listBuckets();
      const bucket = buckets.find((b) => b.name === bucketName);
      expect(bucket).toBeDefined();
      expect(bucket?.maxFileSize).toBeNull();
    });

    it('should create bucket without max file size (undefined)', async () => {
      const bucketName = 'test-bucket-3';

      await storageService.createBucket(bucketName, true);

      const buckets = await storageService.listBuckets();
      const bucket = buckets.find((b) => b.name === bucketName);
      expect(bucket).toBeDefined();
      expect(bucket?.maxFileSize).toBeNull();
    });
  });

  describe('getBucketMaxFileSize', () => {
    it('should return bucket-specific max file size', async () => {
      const bucketName = 'test-bucket-1';
      const maxFileSize = 10 * 1024 * 1024; // 10MB

      await storageService.createBucket(bucketName, true, maxFileSize);

      const retrievedMaxSize = await storageService.getBucketMaxFileSize(bucketName);
      expect(retrievedMaxSize).toBe(maxFileSize);
    });

    it('should return null for bucket without max file size', async () => {
      const bucketName = 'test-bucket-2';

      await storageService.createBucket(bucketName, true);

      const retrievedMaxSize = await storageService.getBucketMaxFileSize(bucketName);
      expect(retrievedMaxSize).toBeNull();
    });

    it('should return null for non-existent bucket', async () => {
      const retrievedMaxSize = await storageService.getBucketMaxFileSize('non-existent-bucket');
      expect(retrievedMaxSize).toBeNull();
    });
  });

  describe('updateBucket with maxFileSize', () => {
    it('should update bucket max file size', async () => {
      const bucketName = 'test-bucket-1';
      const initialMaxSize = 5 * 1024 * 1024; // 5MB
      const updatedMaxSize = 20 * 1024 * 1024; // 20MB

      await storageService.createBucket(bucketName, true, initialMaxSize);

      await storageService.updateBucket(bucketName, { maxFileSize: updatedMaxSize });

      const retrievedMaxSize = await storageService.getBucketMaxFileSize(bucketName);
      expect(retrievedMaxSize).toBe(updatedMaxSize);
    });

    it('should set max file size to null (use global limit)', async () => {
      const bucketName = 'test-bucket-1';
      const initialMaxSize = 5 * 1024 * 1024; // 5MB

      await storageService.createBucket(bucketName, true, initialMaxSize);

      await storageService.updateBucket(bucketName, { maxFileSize: null });

      const retrievedMaxSize = await storageService.getBucketMaxFileSize(bucketName);
      expect(retrievedMaxSize).toBeNull();
    });

    it('should update both visibility and max file size', async () => {
      const bucketName = 'test-bucket-1';
      const maxFileSize = 15 * 1024 * 1024; // 15MB

      await storageService.createBucket(bucketName, true);

      await storageService.updateBucket(bucketName, {
        isPublic: false,
        maxFileSize,
      });

      const isPublic = await storageService.isBucketPublic(bucketName);
      const retrievedMaxSize = await storageService.getBucketMaxFileSize(bucketName);

      expect(isPublic).toBe(false);
      expect(retrievedMaxSize).toBe(maxFileSize);
    });
  });

  describe('listBuckets includes maxFileSize', () => {
    it('should include maxFileSize in bucket list', async () => {
      const bucketName1 = 'test-bucket-1';
      const bucketName2 = 'test-bucket-2';
      const maxFileSize1 = 5 * 1024 * 1024; // 5MB

      await storageService.createBucket(bucketName1, true, maxFileSize1);
      await storageService.createBucket(bucketName2, true); // No max file size

      const buckets = await storageService.listBuckets();
      const bucket1 = buckets.find((b) => b.name === bucketName1);
      const bucket2 = buckets.find((b) => b.name === bucketName2);

      expect(bucket1?.maxFileSize).toBe(maxFileSize1);
      expect(bucket2?.maxFileSize).toBeNull();
    });
  });
});

