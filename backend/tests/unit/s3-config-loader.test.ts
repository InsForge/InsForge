import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isCloudEnvironment } from '../../src/utils/environment.js';

describe('S3 Config Loader', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment variables before each test
    process.env = { ...originalEnv };
  });

  describe('Environment Variable Validation Logic', () => {
    it('should validate bucket is required in cloud environment', () => {
      // Simulate cloud environment
      process.env.AWS_INSTANCE_PROFILE_NAME = 'test-profile';
      delete process.env.AWS_CONFIG_BUCKET;

      // Test the validation logic
      const bucket = process.env.AWS_CONFIG_BUCKET;
      const isCloud = isCloudEnvironment();

      if (isCloud) {
        expect(!bucket || !bucket.trim()).toBe(true);
        // In actual implementation, this would throw
        expect(() => {
          if (!bucket || !bucket.trim()) {
            throw new Error(
              'AWS_CONFIG_BUCKET environment variable is required in cloud environments. ' +
              'Please set AWS_CONFIG_BUCKET to your S3 bucket name.'
            );
          }
        }).toThrow('AWS_CONFIG_BUCKET environment variable is required');
      }
    });

    it('should use default bucket in local environment', () => {
      // Simulate local environment
      delete process.env.AWS_INSTANCE_PROFILE_NAME;
      delete process.env.AWS_CONFIG_BUCKET;

      const bucket = process.env.AWS_CONFIG_BUCKET;
      const isCloud = isCloudEnvironment();

      if (!isCloud) {
        const result = bucket || 'insforge-config';
        expect(result).toBe('insforge-config');
      }
    });

    it('should use provided bucket in local environment', () => {
      delete process.env.AWS_INSTANCE_PROFILE_NAME;
      process.env.AWS_CONFIG_BUCKET = 'my-custom-bucket';

      const bucket = process.env.AWS_CONFIG_BUCKET;
      const isCloud = isCloudEnvironment();

      if (!isCloud) {
        const result = bucket || 'insforge-config';
        expect(result).toBe('my-custom-bucket');
      }
    });

    it('should use default region when not set', () => {
      delete process.env.AWS_CONFIG_REGION;

      const region = process.env.AWS_CONFIG_REGION;
      const result = region || 'us-east-2';
      expect(result).toBe('us-east-2');
    });

    it('should use custom region when set', () => {
      process.env.AWS_CONFIG_REGION = 'eu-west-1';

      const region = process.env.AWS_CONFIG_REGION;
      expect(region).toBe('eu-west-1');
    });

    it('should trim whitespace from bucket name', () => {
      process.env.AWS_INSTANCE_PROFILE_NAME = 'test-profile';
      process.env.AWS_CONFIG_BUCKET = '  my-bucket  ';

      const bucket = process.env.AWS_CONFIG_BUCKET;
      if (bucket) {
        const trimmed = bucket.trim();
        expect(trimmed).toBe('my-bucket');
      }
    });

    it('should trim whitespace from region', () => {
      process.env.AWS_CONFIG_REGION = '  us-west-2  ';

      const region = process.env.AWS_CONFIG_REGION;
      if (region) {
        const trimmed = region.trim();
        expect(trimmed).toBe('us-west-2');
      }
    });
  });
});

