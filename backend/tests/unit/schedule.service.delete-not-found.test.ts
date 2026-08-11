import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret-long-enough-for-signing-32chars';
});

const queryMock = vi.hoisted(() => vi.fn());

vi.mock('@/infra/database/database.manager.js', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => ({ query: queryMock }),
    }),
  },
}));

vi.mock('@/services/secrets/secret.service.js', () => ({
  SecretService: {
    getInstance: () => ({}),
  },
}));

import { ScheduleService } from '@/services/schedules/schedule.service.js';
import { AppError } from '@/utils/errors.js';

describe('ScheduleService.deleteSchedule on a missing schedule', () => {
  const missingId = '00000000-0000-4000-8000-000000000000';

  beforeEach(() => {
    queryMock.mockReset();
  });

  it('reports 404 SCHEDULE_NOT_FOUND rather than a 500 database error', async () => {
    // schedules.delete_job() returns (success=false, message='Job not found')
    // for an id that is not in schedules.jobs (migration 021).
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('delete_job')) {
        return Promise.resolve({ rows: [{ success: false, message: 'Job not found' }] });
      }
      // getScheduleById lookup finds nothing
      return Promise.resolve({ rows: [] });
    });

    const service = ScheduleService.getInstance();
    const error = await service.deleteSchedule(missingId).then(
      () => null,
      (e: unknown) => e
    );

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).statusCode).toBe(404);
    expect((error as AppError).code).toBe('SCHEDULE_NOT_FOUND');
  });

  it('still deletes an existing schedule', async () => {
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('delete_job')) {
        return Promise.resolve({
          rows: [{ success: true, message: 'Cron job deleted successfully' }],
        });
      }
      return Promise.resolve({
        rows: [
          {
            id: missingId,
            name: 'nightly',
            cronSchedule: '0 0 * * *',
            functionUrl: 'https://example.com/hook',
            httpMethod: 'POST',
            isActive: true,
          },
        ],
      });
    });

    const service = ScheduleService.getInstance();
    await expect(service.deleteSchedule(missingId)).resolves.toBeTruthy();
  });
});
