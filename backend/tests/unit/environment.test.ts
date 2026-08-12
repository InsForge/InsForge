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

    // The one marker only our provisioning writes. AWS does not inject it — the SDK
    // reads instance credentials from IMDS and never needs the profile's name — and no
    // self-host artefact mentions it.
    it('is true when the provisioning marker is present', () => {
      process.env.AWS_INSTANCE_PROFILE_NAME = 'EC2-role';
      expect(isCloudManagedProject()).toBe(true);
    });

    // `.env.example` ships PROJECT_ID and getProjectId() documents it as the
    // self-hosted way to scope services.
    it('is false for PROJECT_ID alone', () => {
      process.env.PROJECT_ID = 'my-project';
      expect(isCloudManagedProject()).toBe(false);
    });

    // deploy/zeabur/template.yml fills DEPLOYMENT_ID from ${ZEABUR_SERVICE_ID} and
    // PROJECT_ID from ${ZEABUR_PROJECT_ID}, so a third-party self-host carries both.
    // Reading that pair as ours is what this rule exists to avoid.
    it('is false for a Zeabur-style install carrying both ids', () => {
      process.env.DEPLOYMENT_ID = 'zeabur-service-1';
      process.env.PROJECT_ID = 'zeabur-project-1';
      expect(isCloudManagedProject()).toBe(false);
    });
  });

  // Our OAuth credentials come from the environment cloud provisioning writes, so this
  // follows the project question rather than AWS access.
  it('isOAuthSharedKeysAvailable follows isCloudManagedProject', () => {
    process.env.AWS_INSTANCE_PROFILE_NAME = 'EC2-role';
    expect(isOAuthSharedKeysAvailable()).toBe(true);

    delete process.env.AWS_INSTANCE_PROFILE_NAME;
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
