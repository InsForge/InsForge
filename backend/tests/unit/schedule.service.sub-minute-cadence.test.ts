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

  it('service defines an INTERVAL_RE that accepts seconds/minutes/hours', () => {
    // Must declare an INTERVAL_RE (or equivalent) constant
    expect(serviceSrc).toMatch(/INTERVAL_RE\s*=\s*\//);
    // The regex alternation must contain (seconds?|minutes?|hours?)
    expect(serviceSrc).toMatch(/\(seconds\?\|minutes\?\|hours\?\)/);
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

  it('service interval next-run handles seconds, minutes, and hours multipliers', () => {
    // 1_000 (sec), 60_000 (min), 3_600_000 (hour) — accept underscores or plain digits
    expect(serviceSrc).toMatch(/3[_]?600[_]?000/);
    expect(serviceSrc).toMatch(/60[_]?000/);
    expect(serviceSrc).toMatch(/\b1[_]?000\b/);
  });

  it('shared-schemas cron validator accepts the interval form (2-part strings)', () => {
    // The refine() must accept "2 seconds" etc. — i.e., it must mention the interval pattern
    // or accept length === 2 with a units check.
    expect(sharedSrc).toMatch(/seconds\?\s*\|\s*minutes\?\s*\|\s*hours\?/i);
  });

  it('shared-schemas error message mentions interval form', () => {
    expect(sharedSrc).toMatch(/seconds|interval/i);
  });
});

// Behavioural sanity checks on the regex shape. These don't import the service
// (which needs DatabaseManager); instead, re-derive the same pattern and assert
// it accepts the inputs we care about and rejects the ones we don't.
describe('Sub-minute cadence regex behaviour', () => {
  const INTERVAL_RE = /^\s*(\d+)\s+(seconds?|minutes?|hours?)\s*$/i;

  it.each([
    ['1 second', '1', 'second'],
    ['2 seconds', '2', 'seconds'],
    ['30 seconds', '30', 'seconds'],
    ['90 seconds', '90', 'seconds'],
    ['1 minute', '1', 'minute'],
    ['5 minutes', '5', 'minutes'],
    ['1 hour', '1', 'hour'],
    ['12 hours', '12', 'hours'],
    [' 30 SECONDS ', '30', 'SECONDS'],
  ])('accepts %j as interval', (input, n, unit) => {
    const m = input.match(INTERVAL_RE);
    expect(m).not.toBeNull();
    expect(m?.[1]).toBe(n);
    expect(m?.[2]).toBe(unit);
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
    '* * * * * *',
  ])('rejects %j as interval', (input) => {
    expect(input.match(INTERVAL_RE)).toBeNull();
  });
});
