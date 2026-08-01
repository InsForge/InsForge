import { EventEmitter } from 'events';
import { describe, expect, it } from 'vitest';
import type { Request, Response } from 'express';
import {
  FeatureUsageCollector,
  isDashboardRead,
  resolveFeature,
} from '../../src/services/telemetry/feature-usage.collector';

function makeRequest(method: string, path: string, extra: Record<string, unknown> = {}): Request {
  return { method, path, headers: {}, ...extra } as unknown as Request;
}

const DASHBOARD = { user: { id: 'admin-1', role: 'project_admin' } };

describe('resolveFeature', () => {
  it('maps API routes to their feature', () => {
    expect(resolveFeature('/api/database/records/posts')).toBe('database');
    expect(resolveFeature('/api/auth/sessions')).toBe('auth');
    expect(resolveFeature('/api/compute/services')).toBe('compute');
  });

  it('counts the S3 gateway as storage', () => {
    expect(resolveFeature('/storage/v1/s3/my-bucket/key.png')).toBe('storage');
    expect(resolveFeature('/storage/v1/s3')).toBe('storage');
  });

  it('counts direct edge function invocations as functions', () => {
    expect(resolveFeature('/functions/send-email')).toBe('functions');
  });

  it('excludes dashboard sign-in, refresh and logout', () => {
    expect(resolveFeature('/api/auth/admin/sessions')).toBeNull();
    expect(resolveFeature('/api/auth/admin/sessions/exchange')).toBeNull();
    expect(resolveFeature('/api/auth/admin/refresh')).toBeNull();
    expect(resolveFeature('/api/auth/admin/logout')).toBeNull();
  });

  it('ignores traffic that is not feature usage', () => {
    expect(resolveFeature('/api/health')).toBeNull();
    expect(resolveFeature('/.well-known/jwks.json')).toBeNull();
    expect(resolveFeature('/functions/')).toBeNull();
    expect(resolveFeature('/assets/index-a1b2c3.js')).toBeNull();
    expect(resolveFeature('/')).toBeNull();
  });

  it('ignores unknown API segments so the property space stays bounded', () => {
    expect(resolveFeature('/api/not-a-feature/x')).toBeNull();
  });
});

describe('isDashboardRead', () => {
  it('is true only for reads from a dashboard session', () => {
    expect(isDashboardRead(makeRequest('GET', '/api/database/tables', DASHBOARD))).toBe(true);
    expect(isDashboardRead(makeRequest('HEAD', '/api/metadata', DASHBOARD))).toBe(true);
  });

  it('is false for dashboard writes', () => {
    expect(isDashboardRead(makeRequest('POST', '/api/database/tables', DASHBOARD))).toBe(false);
    expect(isDashboardRead(makeRequest('DELETE', '/api/storage/buckets/media', DASHBOARD))).toBe(
      false
    );
  });

  it('is false for every non-dashboard caller, whatever the credential', () => {
    expect(isDashboardRead(makeRequest('GET', '/api/database/records/posts'))).toBe(false);
    expect(
      isDashboardRead(makeRequest('GET', '/api/database/records/posts', { hasApiKey: true }))
    ).toBe(false);
    expect(
      isDashboardRead(
        makeRequest('GET', '/api/database/records/posts', { user: { role: 'authenticated' } })
      )
    ).toBe(false);
  });
});

describe('FeatureUsageCollector', () => {
  // The middleware sees the request before auth runs; the caller is only
  // resolved onto it by the time the response finishes.
  function track(collector: FeatureUsageCollector, req: Request): void {
    const res = new EventEmitter() as unknown as Response;
    collector.track(req, res);
    res.emit('finish');
  }

  it('records the set of features used, once each, and resets on drain', () => {
    const collector = new FeatureUsageCollector();

    track(collector, makeRequest('GET', '/api/database/records/posts'));
    track(collector, makeRequest('POST', '/api/database/records/posts'));
    track(collector, makeRequest('GET', '/functions/send-email'));
    track(collector, makeRequest('PUT', '/storage/v1/s3/media/logo.png'));

    const first = collector.drain();
    expect(first.featuresUsed).toEqual(['database', 'functions', 'storage']);
    expect(first.windowMs).toEqual(expect.any(Number));

    const second = collector.drain();
    expect(second.featuresUsed).toEqual([]);
  });

  it('ignores dashboard reads but keeps dashboard writes', () => {
    const collector = new FeatureUsageCollector();

    track(collector, makeRequest('GET', '/api/metadata', DASHBOARD));
    track(collector, makeRequest('GET', '/api/logs', DASHBOARD));
    track(collector, makeRequest('GET', '/api/database/tables', DASHBOARD));
    track(collector, makeRequest('POST', '/api/database/tables', DASHBOARD));

    expect(collector.drain().featuresUsed).toEqual(['database']);
  });

  it('records app reads on the same paths a dashboard read would be ignored on', () => {
    const collector = new FeatureUsageCollector();

    track(collector, makeRequest('GET', '/api/database/records/posts'));

    expect(collector.drain().featuresUsed).toEqual(['database']);
  });

  it('ignores admin auth and non-feature paths', () => {
    const collector = new FeatureUsageCollector();

    track(collector, makeRequest('POST', '/api/auth/admin/sessions'));
    track(collector, makeRequest('POST', '/api/auth/admin/refresh'));
    track(collector, makeRequest('GET', '/api/health'));
    track(collector, makeRequest('GET', '/assets/index-a1b2c3.js'));

    expect(collector.drain().featuresUsed).toEqual([]);
  });
});
