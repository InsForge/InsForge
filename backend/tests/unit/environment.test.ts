import {
  hasAwsInstanceProfile,
  isCloudManagedProject,
  isOAuthSharedKeysAvailable,
  isDevelopment,
  isProduction,
} from '../../src/utils/environment';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';

describe('Environment utils', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('hasAwsInstanceProfile follows AWS_INSTANCE_PROFILE_NAME', () => {
    process.env.AWS_INSTANCE_PROFILE_NAME = 'my-profile';
    expect(hasAwsInstanceProfile()).toBe(true);

    delete process.env.AWS_INSTANCE_PROFILE_NAME;
    expect(hasAwsInstanceProfile()).toBe(false);
  });

  describe('isCloudManagedProject', () => {
    beforeEach(() => {
      delete process.env.AWS_INSTANCE_PROFILE_NAME;
      delete process.env.DEPLOYMENT_ID;
      delete process.env.PROJECT_ID;
    });

    // The pair our provisioning writes on every instance.
    it('is true when DEPLOYMENT_ID and PROJECT_ID are both set', () => {
      process.env.DEPLOYMENT_ID = 'dep-1';
      process.env.PROJECT_ID = 'proj-1';
      expect(isCloudManagedProject()).toBe(true);
    });

    // PROJECT_ID is documented as the self-hosted way to scope services, so on its own
    // it must not mark a deployment as ours.
    it('is false for PROJECT_ID alone', () => {
      process.env.PROJECT_ID = 'my-project';
      expect(isCloudManagedProject()).toBe(false);
    });

    // Nothing else in the codebase reads DEPLOYMENT_ID; alone it proves nothing either.
    it('is false for DEPLOYMENT_ID alone', () => {
      process.env.DEPLOYMENT_ID = 'dep-1';
      expect(isCloudManagedProject()).toBe(false);
    });

    // 'local' is the placeholder a self-host install ends up with.
    it("is false when PROJECT_ID is 'local'", () => {
      process.env.DEPLOYMENT_ID = 'dep-1';
      process.env.PROJECT_ID = 'local';
      expect(isCloudManagedProject()).toBe(false);
    });

    // Independent second signal, so this is never weaker than the old check.
    it('is true on an instance profile alone', () => {
      process.env.AWS_INSTANCE_PROFILE_NAME = 'EC2-role';
      expect(isCloudManagedProject()).toBe(true);
    });
  });

  // Our OAuth credentials come from the environment cloud provisioning writes, so this
  // follows the project question rather than AWS access.
  it('isOAuthSharedKeysAvailable follows isCloudManagedProject', () => {
    delete process.env.AWS_INSTANCE_PROFILE_NAME;
    process.env.DEPLOYMENT_ID = 'dep-1';
    process.env.PROJECT_ID = 'proj-1';
    expect(isOAuthSharedKeysAvailable()).toBe(true);

    delete process.env.DEPLOYMENT_ID;
    expect(isOAuthSharedKeysAvailable()).toBe(false);
  });

  it('isDevelopment works correctly', () => {
    process.env.NODE_ENV = 'development';
    expect(isDevelopment()).toBe(true);

    process.env.NODE_ENV = 'production';
    expect(isDevelopment()).toBe(false);

    process.env.NODE_ENV = 'test';
    expect(isDevelopment()).toBe(false);

    delete process.env.NODE_ENV;
    expect(isDevelopment()).toBe(false);
  });

  it('isProduction works correctly', () => {
    process.env.NODE_ENV = 'production';
    expect(isProduction()).toBe(true);

    process.env.NODE_ENV = 'development';
    expect(isProduction()).toBe(false);

    delete process.env.NODE_ENV;
    expect(isProduction()).toBe(false);
  });
});
