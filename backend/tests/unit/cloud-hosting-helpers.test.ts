import { describe, it, expect } from 'vitest';
import { getErrorMessage, normalizeProjectInfo } from '../../../frontend/src/cloud-hosting/helpers';

/**
 * Covers the pure helpers behind the cloud-hosting postMessage bridge, as
 * imported from the module that ships them. The suite previously defined its
 * own copies, so it passed no matter what the real helpers did.
 */

describe('Cloud Hosting Helpers', () => {
  describe('getErrorMessage', () => {
    it('returns the message when it is a non-empty string', () => {
      expect(getErrorMessage('Something went wrong', 'fallback')).toBe('Something went wrong');
    });

    it('returns fallback for empty string', () => {
      expect(getErrorMessage('', 'fallback')).toBe('fallback');
    });

    it('returns fallback for whitespace-only string', () => {
      expect(getErrorMessage('   ', 'fallback')).toBe('fallback');
    });

    it('returns fallback for non-string values', () => {
      expect(getErrorMessage(null, 'fallback')).toBe('fallback');
      expect(getErrorMessage(undefined, 'fallback')).toBe('fallback');
      expect(getErrorMessage(42, 'fallback')).toBe('fallback');
      expect(getErrorMessage({}, 'fallback')).toBe('fallback');
    });
  });

  describe('normalizeProjectInfo', () => {
    const backendUrl = 'https://test.insforge.app';

    it('uses defaults when no previous info exists', () => {
      const result = normalizeProjectInfo(undefined, backendUrl, { type: 'PROJECT_INFO' });
      expect(result.id).toBe(backendUrl);
      expect(result.name).toBe('Project');
      expect(result.region).toBe('');
      expect(result.instanceType).toBe('');
    });

    it('extracts fields from message', () => {
      const result = normalizeProjectInfo(undefined, backendUrl, {
        type: 'PROJECT_INFO',
        id: 'proj-123',
        name: 'My Project',
        region: 'us-east-1',
        instanceType: 'micro',
        status: 'active',
      });
      expect(result.id).toBe('proj-123');
      expect(result.name).toBe('My Project');
      expect(result.region).toBe('us-east-1');
      expect(result.instanceType).toBe('micro');
      expect(result.status).toBe('active');
    });

    it('preserves previous info for missing message fields', () => {
      const previous = {
        id: 'proj-old',
        name: 'Old Name',
        region: 'eu-west-1',
        instanceType: 'nano',
      };
      const result = normalizeProjectInfo(previous, backendUrl, {
        type: 'PROJECT_INFO',
        name: 'New Name',
      });
      expect(result.id).toBe('proj-old');
      expect(result.name).toBe('New Name');
      expect(result.region).toBe('eu-west-1');
      expect(result.instanceType).toBe('nano');
    });

    it('ignores non-string message fields', () => {
      const result = normalizeProjectInfo(undefined, backendUrl, {
        type: 'PROJECT_INFO',
        name: 123,
        region: null,
        instanceType: undefined,
      });
      expect(result.name).toBe('Project');
      expect(result.region).toBe('');
      expect(result.instanceType).toBe('');
    });

    it('handles latestVersion as null', () => {
      const result = normalizeProjectInfo(undefined, backendUrl, {
        type: 'PROJECT_INFO',
        latestVersion: null,
      });
      expect(result.latestVersion).toBeNull();
    });

    it('handles latestVersion as string', () => {
      const result = normalizeProjectInfo(undefined, backendUrl, {
        type: 'PROJECT_INFO',
        latestVersion: '2.0.3',
      });
      expect(result.latestVersion).toBe('2.0.3');
    });
  });
});
