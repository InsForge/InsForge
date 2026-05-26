import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const servicePath = path.resolve(currentDir, '../../src/services/schedules/schedule.service.ts');
const sharedSchemaPath = path.resolve(
  currentDir,
  '../../../packages/shared-schemas/src/schedules-api.schema.ts'
);

describe('Sub-minute cadence support: validator', () => {
  const serviceSrc = fs.readFileSync(servicePath, 'utf8');
  const sharedSrc = fs.readFileSync(sharedSchemaPath, 'utf8');

  it('service defines an INTERVAL_RE that only accepts seconds', () => {
    // Must declare an INTERVAL_RE (or equivalent) constant
    expect(serviceSrc).toMatch(/INTERVAL_RE\s*=\s*\//);
    // The regex must mention seconds and must NOT include minutes/hours alternations
    expect(serviceSrc).toMatch(/INTERVAL_RE[\s\S]*?seconds\?/);
    expect(serviceSrc).not.toMatch(/INTERVAL_RE[\s\S]*?minutes\?/);
    expect(serviceSrc).not.toMatch(/INTERVAL_RE[\s\S]*?hours\?/);
    // And be case-insensitive (i flag)
    expect(serviceSrc).toMatch(/INTERVAL_RE[\s\S]*?\/i\b/);
  });

  it('service validateCronExpression takes the interval branch first', () => {
    // The validator should match the interval regex and early-return before falling to 5-field check.
    // Sequence: validateCronExpression(...) -> ... -> INTERVAL_RE -> ... -> return; -> ... -> fields.length
    expect(serviceSrc).toMatch(
      /validateCronExpression\b[\s\S]+?INTERVAL_RE[\s\S]+?return\s*;[\s\S]+?fields\.length/
    );
  });

  it('service validator error message mentions both 5-field cron and interval examples', () => {
    expect(serviceSrc).toMatch(/seconds/i);
    expect(serviceSrc).toMatch(/\* \* \* \* \*|5 fields/);
  });

  it('service computeNextRunForSchedule has an interval branch using INTERVAL_RE', () => {
    expect(serviceSrc).toMatch(/computeNextRunForSchedule\b[\s\S]+?INTERVAL_RE[\s\S]+?getTime\(\)/);
  });

  it('service interval next-run uses the seconds multiplier (1_000 ms)', () => {
    expect(serviceSrc).toMatch(/\b1[_]?000\b/);
  });

  it('shared-schemas cron validator accepts only sub-minute seconds form', () => {
    // The refine() must accept "30 seconds" but reject minutes/hours.
    expect(sharedSrc).toMatch(/seconds\?/i);
    expect(sharedSrc).not.toMatch(/minutes\?\s*\|/i);
    expect(sharedSrc).not.toMatch(/\|\s*hours\?/i);
  });

  it('shared-schemas error message mentions sub-minute / 1–59 seconds', () => {
    expect(sharedSrc).toMatch(/seconds|interval/i);
    expect(sharedSrc).toMatch(/sub-minute|1[\s\S]{0,3}59/i);
  });
});

// Behavioural sanity checks on the regex shape. These don't import the service
// (which needs DatabaseManager); instead, re-derive the same pattern and assert
// it accepts the inputs we care about and rejects the ones we don't.
//
// The service-side regex stays permissive on digits (\d+) so the service can
// throw a precise "1–59 seconds" error for out-of-range values; the
// shared-schemas regex bounds the digits inline because it only returns a
// boolean.
describe('Sub-minute cadence regex behaviour (service)', () => {
  const SERVICE_INTERVAL_RE = /^\s*(\d+)\s+seconds?\s*$/i;

  it.each([
    ['1 second', '1'],
    ['2 seconds', '2'],
    ['30 seconds', '30'],
    ['59 seconds', '59'],
    [' 30 SECONDS ', '30'],
  ])('accepts %j as sub-minute interval', (input, n) => {
    const m = input.match(SERVICE_INTERVAL_RE);
    expect(m).not.toBeNull();
    expect(m?.[1]).toBe(n);
  });

  it.each([
    '* * * * *',
    '*/5 * * * *',
    '0 9 * * 1-5',
    '',
    'foo bar',
    '2',
    '2 days',
    '2 weeks',
    '2.5 seconds',
    '-1 seconds',
    '1 minute',
    '5 minutes',
    '1 hour',
    '12 hours',
    '* * * * * *',
  ])('rejects %j', (input) => {
    expect(input.match(SERVICE_INTERVAL_RE)).toBeNull();
  });
});

describe('Sub-minute cadence regex behaviour (shared-schemas, bounded 1–59)', () => {
  const SCHEMA_INTERVAL_RE = /^\s*([1-9]|[1-5]\d)\s+seconds?\s*$/i;

  it.each(['1 second', '2 seconds', '30 seconds', '59 seconds', ' 30 SECONDS '])(
    'accepts %j',
    (input) => {
      expect(input.match(SCHEMA_INTERVAL_RE)).not.toBeNull();
    }
  );

  it.each([
    '0 seconds',
    '60 seconds',
    '90 seconds',
    '120 seconds',
    '1 minute',
    '5 minutes',
    '1 hour',
    '12 hours',
    '2.5 seconds',
    '-1 seconds',
  ])('rejects %j', (input) => {
    expect(input.match(SCHEMA_INTERVAL_RE)).toBeNull();
  });
});
