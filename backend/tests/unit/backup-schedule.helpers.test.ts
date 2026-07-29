import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@insforge/shared-schemas';
import {
  assertValidBackupCron,
  computeNextBackupAt,
  isScheduledBackupDue,
} from '../../src/services/database/backup-schedule.helpers';

describe('assertValidBackupCron', () => {
  it('accepts standard 5-field expressions', () => {
    expect(() => assertValidBackupCron('0 0 * * *')).not.toThrow();
    expect(() => assertValidBackupCron('0 */12 * * *')).not.toThrow();
    expect(() => assertValidBackupCron('30 2 * * 0')).not.toThrow();
  });

  it('rejects 6-field (seconds) expressions', () => {
    expect(() => assertValidBackupCron('0 0 0 * * *')).toThrowError(
      expect.objectContaining({ statusCode: 400, code: ERROR_CODES.INVALID_INPUT })
    );
  });

  it('rejects pg_cron sub-minute interval syntax', () => {
    expect(() => assertValidBackupCron('30 seconds')).toThrowError(
      expect.objectContaining({ statusCode: 400, code: ERROR_CODES.INVALID_INPUT })
    );
  });

  it('rejects expressions cron-parser cannot parse', () => {
    expect(() => assertValidBackupCron('99 99 * * *')).toThrowError(
      expect.objectContaining({ statusCode: 400, code: ERROR_CODES.INVALID_INPUT })
    );
  });

  it('accepts arbitrary schedules that fire at most hourly', () => {
    expect(() => assertValidBackupCron('30 */2 * * *')).not.toThrow(); // every 2h at :30
    expect(() => assertValidBackupCron('0 * * * *')).not.toThrow(); // hourly
    expect(() => assertValidBackupCron('45 4 1 * *')).not.toThrow(); // monthly
  });

  it('rejects schedules that could fire more than once per hour', () => {
    for (const expr of ['*/30 * * * *', '0,30 2 * * *', '* * * * *', '0-5 2 * * *']) {
      expect(() => assertValidBackupCron(expr), expr).toThrowError(
        expect.objectContaining({ statusCode: 400, code: ERROR_CODES.INVALID_INPUT })
      );
    }
  });
});

describe('computeNextBackupAt', () => {
  it('computes the next fire time in UTC', () => {
    expect(computeNextBackupAt('0 0 * * *', new Date('2026-07-29T15:30:00Z'))).toBe(
      '2026-07-30T00:00:00.000Z'
    );
  });

  it('returns null for an invalid expression instead of throwing', () => {
    expect(computeNextBackupAt('not-a-cron', new Date('2026-07-29T15:30:00Z'))).toBeNull();
  });
});

describe('isScheduledBackupDue', () => {
  const daily = '0 0 * * *';
  const now = new Date('2026-07-29T15:30:00Z'); // most recent fire: 2026-07-29T00:00Z

  it('is due when the last fire is newer than the last attempt and config change', () => {
    expect(
      isScheduledBackupDue({
        cronSchedule: daily,
        now,
        lastAttemptAt: new Date('2026-07-28T00:00:05Z'),
        configUpdatedAt: new Date('2026-07-01T00:00:00Z'),
      })
    ).toBe(true);
  });

  it('is not due when a scheduled attempt already covered the last fire', () => {
    expect(
      isScheduledBackupDue({
        cronSchedule: daily,
        now,
        lastAttemptAt: new Date('2026-07-29T00:00:05Z'),
        configUpdatedAt: new Date('2026-07-01T00:00:00Z'),
      })
    ).toBe(false);
  });

  it('does not fire immediately when the schedule was just enabled', () => {
    // Enabled at 15:00 — the midnight fire predates the config change, so the
    // first backup waits for the next midnight.
    expect(
      isScheduledBackupDue({
        cronSchedule: daily,
        now,
        lastAttemptAt: null,
        configUpdatedAt: new Date('2026-07-29T15:00:00Z'),
      })
    ).toBe(false);
  });

  it('catches up after downtime spanning a fire time', () => {
    // Last attempt two days ago; the server was down over last midnight.
    expect(
      isScheduledBackupDue({
        cronSchedule: daily,
        now,
        lastAttemptAt: new Date('2026-07-27T00:00:05Z'),
        configUpdatedAt: new Date('2026-07-01T00:00:00Z'),
      })
    ).toBe(true);
  });

  it('is due with no prior attempts once a fire follows the config change', () => {
    expect(
      isScheduledBackupDue({
        cronSchedule: daily,
        now,
        lastAttemptAt: null,
        configUpdatedAt: new Date('2026-07-28T15:00:00Z'),
      })
    ).toBe(true);
  });

  it('returns false for an invalid cron expression', () => {
    expect(
      isScheduledBackupDue({
        cronSchedule: 'garbage',
        now,
        lastAttemptAt: null,
        configUpdatedAt: null,
      })
    ).toBe(false);
  });
});
