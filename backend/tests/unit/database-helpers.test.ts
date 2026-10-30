import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/utils/errors';
import { ERROR_CODES } from '@insforge/shared-schemas';
import {
  assertValidBackupCron,
  buildQualifiedTableKey,
  computeNextBackupAt,
  isInternalDashboardSchema,
  isScheduledBackupDue,
  normalizeDatabaseSchemaName,
  postgrestProfileHeaderName,
  quoteQualifiedName,
  resolvePostgrestSchema,
  splitQualifiedTableReference,
} from '../../src/services/database/helpers';

describe('database helpers', () => {
  it('defaults missing schema names to public', () => {
    expect(normalizeDatabaseSchemaName(undefined)).toBe('public');
    expect(normalizeDatabaseSchemaName('   ')).toBe('public');
  });

  it('preserves explicit schema names', () => {
    expect(normalizeDatabaseSchemaName('auth')).toBe('auth');
    expect(normalizeDatabaseSchemaName('analytics')).toBe('analytics');
  });

  it('rejects internal schemas for dashboard routes', () => {
    expect(() => normalizeDatabaseSchemaName('information_schema')).toThrow(AppError);
    expect(() => normalizeDatabaseSchemaName('pg_catalog')).toThrow(AppError);
  });

  it('splits qualified table references and falls back to public for bare names', () => {
    expect(splitQualifiedTableReference('orders')).toEqual({
      schemaName: 'public',
      tableName: 'orders',
    });

    expect(splitQualifiedTableReference('analytics.orders')).toEqual({
      schemaName: 'analytics',
      tableName: 'orders',
    });
  });

  it('rejects malformed qualified table references', () => {
    expect(() => splitQualifiedTableReference('too.many.parts')).toThrow(AppError);
  });

  it('formats qualified names and cache keys consistently', () => {
    expect(quoteQualifiedName('analytics', 'orders')).toBe('"analytics"."orders"');
    expect(buildQualifiedTableKey('orders', 'analytics')).toBe('analytics.orders');
  });

  it('detects internal schemas', () => {
    expect(isInternalDashboardSchema('information_schema')).toBe(true);
    expect(isInternalDashboardSchema('pg_catalog')).toBe(true);
    expect(isInternalDashboardSchema('analytics')).toBe(false);
  });
});

describe('resolvePostgrestSchema', () => {
  it('maps the method to the right PostgREST profile header', () => {
    expect(postgrestProfileHeaderName('GET')).toBe('accept-profile');
    expect(postgrestProfileHeaderName('head')).toBe('accept-profile');
    expect(postgrestProfileHeaderName('POST')).toBe('content-profile');
    expect(postgrestProfileHeaderName('PATCH')).toBe('content-profile');
    expect(postgrestProfileHeaderName('DELETE')).toBe('content-profile');
  });

  it('defaults to public with no schema param or profile header', () => {
    const result = resolvePostgrestSchema('GET', { select: '*' }, {});
    expect(result.schemaName).toBe('public');
    expect(result.query).toEqual({ select: '*' });
    expect(result.headers['accept-profile']).toBeUndefined();
  });

  it('desugars ?schema= on reads into Accept-Profile and strips it from the query', () => {
    const result = resolvePostgrestSchema('GET', { schema: 'analytics', select: '*' }, {});
    expect(result.schemaName).toBe('analytics');
    expect(result.headers['accept-profile']).toBe('analytics');
    expect(result.query).toEqual({ select: '*' });
    expect('schema' in result.query).toBe(false);
  });

  it('desugars ?schema= on writes into Content-Profile', () => {
    const result = resolvePostgrestSchema('POST', { schema: 'analytics' }, {});
    expect(result.schemaName).toBe('analytics');
    expect(result.headers['content-profile']).toBe('analytics');
    expect('accept-profile' in result.headers).toBe(false);
  });

  it('honors a client-sent profile header when no ?schema= is present', () => {
    const read = resolvePostgrestSchema('GET', {}, { 'accept-profile': 'analytics' });
    expect(read.schemaName).toBe('analytics');

    const write = resolvePostgrestSchema('POST', {}, { 'content-profile': 'analytics' });
    expect(write.schemaName).toBe('analytics');
  });

  it('lets ?schema= override a client-sent profile header', () => {
    const result = resolvePostgrestSchema(
      'GET',
      { schema: 'analytics' },
      { 'accept-profile': 'reporting' }
    );
    expect(result.schemaName).toBe('analytics');
    expect(result.headers['accept-profile']).toBe('analytics');
  });

  it('rejects internal schemas passed via ?schema=', () => {
    expect(() => resolvePostgrestSchema('GET', { schema: 'pg_catalog' }, {})).toThrow(AppError);
    expect(() => resolvePostgrestSchema('GET', { schema: 'information_schema' }, {})).toThrow(
      AppError
    );
  });

  it('rejects a malformed explicit ?schema= instead of falling back to public', () => {
    // Blank value.
    expect(() => resolvePostgrestSchema('GET', { schema: '' }, {})).toThrow(AppError);
    // Repeated param: Express parses `?schema=a&schema=b` as an array.
    expect(() => resolvePostgrestSchema('GET', { schema: ['a', 'b'] }, {})).toThrow(AppError);
  });

  it('rejects an array-valued profile header', () => {
    expect(() =>
      resolvePostgrestSchema('GET', {}, { 'accept-profile': ['analytics', 'reporting'] })
    ).toThrow(AppError);
  });

  it('re-forwards the normalized profile header so it cannot disagree with schemaName', () => {
    const result = resolvePostgrestSchema('GET', {}, { 'accept-profile': '  analytics  ' });
    expect(result.schemaName).toBe('analytics');
    expect(result.headers['accept-profile']).toBe('analytics');
  });
});

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
        scheduleAnchorAt: new Date('2026-07-01T00:00:00Z'),
      })
    ).toBe(true);
  });

  it('is not due when a scheduled attempt already covered the last fire', () => {
    expect(
      isScheduledBackupDue({
        cronSchedule: daily,
        now,
        lastAttemptAt: new Date('2026-07-29T00:00:05Z'),
        scheduleAnchorAt: new Date('2026-07-01T00:00:00Z'),
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
        scheduleAnchorAt: new Date('2026-07-29T15:00:00Z'),
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
        scheduleAnchorAt: new Date('2026-07-01T00:00:00Z'),
      })
    ).toBe(true);
  });

  it('is due with no prior attempts once a fire follows the config change', () => {
    expect(
      isScheduledBackupDue({
        cronSchedule: daily,
        now,
        lastAttemptAt: null,
        scheduleAnchorAt: new Date('2026-07-28T15:00:00Z'),
      })
    ).toBe(true);
  });

  it('returns false for an invalid cron expression', () => {
    expect(
      isScheduledBackupDue({
        cronSchedule: 'garbage',
        now,
        lastAttemptAt: null,
        scheduleAnchorAt: null,
      })
    ).toBe(false);
  });
});
