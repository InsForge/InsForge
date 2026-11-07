/**
 * `GET /api/health` publishes the deployment mode (#1879).
 *
 * The dashboard shell picks between the cloud and self-hosting dashboards from
 * `isCloudHosting()` in `frontend/src/helpers.ts`, which could only test its own
 * hostname for `.insforge.app`. A cloud deployment served on a custom domain
 * therefore rendered the self-hosting shell against a cloud backend.
 *
 * These assert the contract the frontend now depends on: `cloud` is exactly what
 * `isCloudEnvironment()` reports — the same value that decides whether backup
 * routes are mounted — so the two determinations cannot drift.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildHealthPayload } from '../../src/utils/health.js';
import { isCloudEnvironment } from '../../src/utils/environment.js';

describe('buildHealthPayload', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('reports cloud: true in a cloud environment', () => {
    process.env.AWS_INSTANCE_PROFILE_NAME = 'my-profile';
    expect(buildHealthPayload('1.2.3').cloud).toBe(true);
  });

  it('reports cloud: false when self-hosted', () => {
    delete process.env.AWS_INSTANCE_PROFILE_NAME;
    expect(buildHealthPayload('1.2.3').cloud).toBe(false);
  });

  it('mirrors isCloudEnvironment rather than deciding for itself', () => {
    // The bug was two independent answers to one question. A second copy of the
    // rule here would reintroduce exactly that, so compare against the source.
    for (const profile of ['my-profile', undefined]) {
      if (profile === undefined) {
        delete process.env.AWS_INSTANCE_PROFILE_NAME;
      } else {
        process.env.AWS_INSTANCE_PROFILE_NAME = profile;
      }
      expect(buildHealthPayload('1.2.3').cloud).toBe(isCloudEnvironment());
    }
  });

  it('does not infer the mode from any hostname', () => {
    // The whole point: a cloud deployment on a custom domain still reports
    // cloud: true. The backend never consults a hostname, so nothing about the
    // domain can change this answer.
    process.env.AWS_INSTANCE_PROFILE_NAME = 'my-profile';
    process.env.API_BASE_URL = 'https://backend.acme-corp.example';
    expect(buildHealthPayload('1.2.3').cloud).toBe(true);
  });

  it('keeps the fields existing consumers already read', () => {
    delete process.env.AWS_INSTANCE_PROFILE_NAME;
    const payload = buildHealthPayload('9.9.9', new Date('2026-01-02T03:04:05.000Z'));

    expect(payload).toEqual({
      status: 'ok',
      version: '9.9.9',
      service: 'Insforge OSS Backend',
      cloud: false,
      timestamp: '2026-01-02T03:04:05.000Z',
    });
  });
});
