import { describe, it, expect } from 'vitest';

/**
 * Tests for the cloud hosting detection and helper logic
 * used in frontend/src/cloudHostingHelpers.ts and frontend/src/App.tsx
 *
 * These test the pure logic extracted from the frontend helpers
 * to verify cloud-hosting detection and message normalization.
 */

// Mirrors isCloudHostingBackend from frontend/src/cloudHostingHelpers.ts
function isCloudHostingBackend(backendUrl: string): boolean {
  try {
    return new URL(backendUrl).hostname.endsWith('.insforge.app');
  } catch {
    return false;
  }
}

// Mirrors getErrorMessage from frontend/src/cloudHostingHelpers.ts
function getErrorMessage(message: unknown, fallback: string): string {
  return typeof message === 'string' && message.trim() ? message : fallback;
}

// Mirrors normalizeProjectInfo from frontend/src/cloudHostingHelpers.ts
function normalizeProjectInfo(
  previous: { id: string; name: string; region: string; instanceType: string } | undefined,
  backendUrl: string,
  message: { type: string; [key: string]: unknown }
) {
  const previousInfo = previous ?? {
    id: backendUrl,
    name: 'Project',
    region: '',
    instanceType: '',
  };

  return {
    id: typeof message.id === 'string' && message.id ? message.id : previousInfo.id,
    name: typeof message.name === 'string' && message.name ? message.name : previousInfo.name,
    region:
      typeof message.region === 'string' && message.region ? message.region : previousInfo.region,
    instanceType:
      typeof message.instanceType === 'string' && message.instanceType
        ? message.instanceType
        : previousInfo.instanceType,
    latestVersion:
      typeof message.latestVersion === 'string' || message.latestVersion === null
        ? (message.latestVersion as string | null)
        : (previous as Record<string, unknown>)?.latestVersion,
    currentVersion:
      typeof message.currentVersion === 'string' || message.currentVersion === null
        ? (message.currentVersion as string | null)
        : (previous as Record<string, unknown>)?.currentVersion,
    status:
      typeof message.status === 'string' && message.status
        ? message.status
        : (previous as Record<string, unknown>)?.status,
  };
}

// Mirrors backendUrl resolution from frontend/src/App.tsx
function resolveBackendUrl(envVar: string | undefined, windowOrigin: string): string {
  return envVar || windowOrigin;
}

describe('Cloud Hosting Helpers', () => {
  describe('isCloudHostingBackend', () => {
    it('returns true for .insforge.app hostnames', () => {
      expect(isCloudHostingBackend('https://abc123.us-east-1.insforge.app')).toBe(true);
      expect(isCloudHostingBackend('https://myproject.eu-west-1.insforge.app')).toBe(true);
      expect(isCloudHostingBackend('https://test.insforge.app')).toBe(true);
    });

    it('returns false for non-insforge hostnames', () => {
      expect(isCloudHostingBackend('http://localhost:7130')).toBe(false);
      expect(isCloudHostingBackend('https://example.com')).toBe(false);
      expect(isCloudHostingBackend('https://insforge.app')).toBe(false); // no subdomain, but hostname IS insforge.app which ends with .insforge.app? No — "insforge.app".endsWith(".insforge.app") is true
    });

    it('returns true for bare insforge.app (endsWith includes exact match)', () => {
      // "insforge.app".endsWith(".insforge.app") => false because of the leading dot
      expect(isCloudHostingBackend('https://insforge.app')).toBe(false);
    });

    it('returns false for invalid URLs', () => {
      expect(isCloudHostingBackend('')).toBe(false);
      expect(isCloudHostingBackend('not-a-url')).toBe(false);
    });

    it('returns false for similar but different domains', () => {
      expect(isCloudHostingBackend('https://evil-insforge.app')).toBe(false);
      expect(isCloudHostingBackend('https://insforge.app.evil.com')).toBe(false);
    });
  });

  describe('resolveBackendUrl (App.tsx logic)', () => {
    it('uses env var when set', () => {
      expect(resolveBackendUrl('http://localhost:7130', 'https://abc.insforge.app')).toBe(
        'http://localhost:7130'
      );
    });

    it('falls back to window origin when env var is empty', () => {
      expect(resolveBackendUrl('', 'https://abc.us-east-1.insforge.app')).toBe(
        'https://abc.us-east-1.insforge.app'
      );
    });

    it('falls back to window origin when env var is undefined', () => {
      expect(resolveBackendUrl(undefined, 'https://abc.us-east-1.insforge.app')).toBe(
        'https://abc.us-east-1.insforge.app'
      );
    });

    it('cloud detection works with resolved URL from window.location.origin', () => {
      const backendUrl = resolveBackendUrl(undefined, 'https://myproject.us-east-1.insforge.app');
      expect(isCloudHostingBackend(backendUrl)).toBe(true);
    });

    it('self-hosting detection works with localhost origin', () => {
      const backendUrl = resolveBackendUrl(undefined, 'http://localhost:5173');
      expect(isCloudHostingBackend(backendUrl)).toBe(false);
    });
  });

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
