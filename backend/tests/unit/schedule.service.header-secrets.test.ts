import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-jwt-secret-for-unit-tests';
});

const queryMock = vi.hoisted(() => vi.fn());
const getSecretByKeyMock = vi.hoisted(() => vi.fn());

vi.mock('@/infra/database/database.manager.js', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => ({ query: queryMock }),
    }),
  },
}));

vi.mock('@/services/secrets/secret.service.js', () => ({
  SecretService: {
    getInstance: () => ({
      getSecretByKey: getSecretByKeyMock,
    }),
  },
}));

import { ScheduleService } from '@/services/schedules/schedule.service.js';

// Secrets from InsForge/InsForge#2201: `$&`, `$'`, backtick-`$ and `$$`
// are replacement patterns for String.replaceAll when the secret is passed
// as the replacement string, so the resolved header is corrupted.
const cases: Array<[string, string]> = [
  ['pa$&ss', 'Bearer pa$&ss'],
  ["tok$'en", "Bearer tok$'en"],
  ['a$`b', 'Bearer a$`b'],
  ['x$$y', 'Bearer x$$y'],
  // control: a secret without any $ pattern must keep resolving as before
  ['plainsecret', 'Bearer plainsecret'],
];

describe('ScheduleService.resolveHeaderSecrets with $ patterns in secrets', () => {
  beforeEach(() => {
    queryMock.mockReset();
    getSecretByKeyMock.mockReset();
    // createSchedule passes the resolved headers as values[6] of upsert_job
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('upsert_job')) {
        return Promise.resolve({ rows: [{ success: true, cron_job_id: '1' }] });
      }
      return Promise.resolve({ rows: [] });
    });
  });

  it.each(cases)(
    'resolves secret %s literally into the Authorization header',
    async (secretValue, expectedHeader) => {
      getSecretByKeyMock.mockImplementation(async () => secretValue);

      const service = ScheduleService.getInstance();
      await service.createSchedule({
        name: 'nightly',
        cronSchedule: '*/5 * * * *',
        httpMethod: 'POST',
        functionUrl: 'https://example.com/hook',
        headers: { Authorization: 'Bearer ${{secrets.API_KEY}}' },
        body: {},
      });

      const upsertCall = queryMock.mock.calls.find((call: unknown[]) =>
        String(call[0]).includes('upsert_job')
      );
      expect(upsertCall).toBeDefined();
      const resolvedHeaders = (upsertCall as unknown[])[1] as Record<string, unknown>[];
      expect(resolvedHeaders[6]).toEqual({ Authorization: expectedHeader });
    }
  );
});

describe('ScheduleService.updateSchedule resolves header secrets literally', () => {
  beforeEach(() => {
    queryMock.mockReset();
    getSecretByKeyMock.mockReset();
  });

  it.each(cases)(
    'resolves secret %s literally into the Authorization header on update',
    async (secretValue, expectedHeader) => {
      getSecretByKeyMock.mockImplementation(async () => secretValue);

      // updateSchedule first loads the existing schedule via getScheduleById,
      // then passes the resolved headers as values[6] of upsert_job.
      queryMock.mockImplementation((sql: string) => {
        if (sql.includes('upsert_job')) {
          return Promise.resolve({ rows: [{ success: true, cron_job_id: '1' }] });
        }
        if (sql.includes('FROM schedules.jobs')) {
          return Promise.resolve({
            rows: [
              {
                id: 'existing-id',
                name: 'nightly',
                cronSchedule: '*/5 * * * *',
                functionUrl: 'https://example.com/hook',
                httpMethod: 'POST',
                body: {},
                headers: { Authorization: 'Bearer ${{secrets.OLD_KEY}}' },
                isActive: true,
                cronJobId: '1',
                createdAt: '2026-11-06T00:00:00.000Z',
                updatedAt: '2026-11-06T00:00:00.000Z',
                lastExecutedAt: null,
              },
            ],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const service = ScheduleService.getInstance();
      await service.updateSchedule('existing-id', {
        headers: { Authorization: 'Bearer ${{secrets.API_KEY}}' },
      });

      const upsertCall = queryMock.mock.calls.find((call: unknown[]) =>
        String(call[0]).includes('upsert_job')
      );
      expect(upsertCall).toBeDefined();
      const resolvedHeaders = (upsertCall as unknown[])[1] as Record<string, unknown>[];
      expect(resolvedHeaders[6]).toEqual({ Authorization: expectedHeader });
    }
  );
});
