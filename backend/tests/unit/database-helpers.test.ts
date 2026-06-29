import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/utils/errors';
import {
  buildQualifiedTableKey,
  isInternalDashboardSchema,
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
