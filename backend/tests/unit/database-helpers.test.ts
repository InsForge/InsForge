import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/api/middlewares/error';
import {
  assertWritableDatabaseSchema,
  buildQualifiedTableKey,
  isInternalDashboardSchema,
  normalizeDatabaseSchemaName,
  quoteQualifiedName,
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

  it('marks insforge managed schemas as read only', () => {
    expect(() => assertWritableDatabaseSchema('auth')).toThrow(AppError);
    expect(() => assertWritableDatabaseSchema('cron')).toThrow(AppError);
    expect(() => assertWritableDatabaseSchema('payments')).toThrow(AppError);
    expect(() => assertWritableDatabaseSchema('public')).not.toThrow();
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
