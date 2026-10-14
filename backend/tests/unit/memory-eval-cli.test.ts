import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseArgs,
  valueAfterFlag,
  resultFileSlug,
  pickLatestResultFile,
  assertEmptyScope,
  assertFixtureOnlyScope,
  fixtureHitsFromRecall,
  classifyCalibrateTarget,
} from '../../src/services/memory/eval/cli.mjs';

describe('eval CLI helpers', () => {
  it('parses --key=value and space-separated --key value', () => {
    expect(parseArgs(['report', '--in=results.json']).in).toBe('results.json');
    expect(parseArgs(['report', '--in', 'results.json']).in).toBe('results.json');
    expect(parseArgs(['sweep', '--scope', 'eval', '--limit', '5']).limit).toBe('5');
  });

  it('keeps the full --scope= value after additional equals signs', () => {
    expect(valueAfterFlag(['--scope=team=prod'], '--scope', 'eval')).toBe('team=prod');
  });

  it('encodes slashes in result filenames', () => {
    expect(resultFileSlug('a/b')).toBe('a%2Fb');
  });

  it('prefers a generated sweep over a newer baseline mtime', () => {
    const dir = mkdtempSync(join(tmpdir(), 'memory-eval-'));
    const sweep = join(dir, 'results-eval-limit5.json');
    const baseline = join(dir, 'baseline-limit5.json');
    writeFileSync(sweep, '{}');
    writeFileSync(baseline, '{}');
    utimesSync(sweep, new Date('2026-01-01'), new Date('2026-01-01'));
    utimesSync(baseline, new Date('2026-08-01'), new Date('2026-08-01'));
    expect(pickLatestResultFile(dir)).toBe(sweep);
  });

  it('falls back to the checked-in baseline when no sweep files exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'memory-eval-'));
    const baseline = join(dir, 'baseline-limit5.json');
    writeFileSync(baseline, '{}');
    expect(pickLatestResultFile(dir)).toBe(baseline);
  });

  it('classifies vector-only vs keyword-retained using threshold 0 vs 1.0', () => {
    const titleToFixture = new Map([
      ['Vec only', 'm-vec'],
      ['Kw outside top 20', 'm-kw'],
    ]);
    const atZero = fixtureHitsFromRecall(
      [
        { title: 'Vec only', similarity: 0.32 },
        { title: 'Kw outside top 20', similarity: 0.51 },
      ],
      titleToFixture
    );
    const atKeywordOnly = fixtureHitsFromRecall(
      [{ title: 'Kw outside top 20', similarity: 0.51 }],
      titleToFixture
    );
    expect(classifyCalibrateTarget('m-vec', atZero, atKeywordOnly).kind).toBe('vector-only');
    expect(classifyCalibrateTarget('m-kw', atZero, atKeywordOnly).kind).toBe('keyword-retained');
    expect(classifyCalibrateTarget('m-missing', atZero, atKeywordOnly).kind).toBe('missing');
    const vectorOnly = ['m-vec', 'm-kw']
      .map((id) => classifyCalibrateTarget(id, atZero, atKeywordOnly))
      .filter((r) => r.kind === 'vector-only');
    expect(vectorOnly).toHaveLength(1);
    expect(vectorOnly.filter((r) => r.similarity <= 0.35)).toHaveLength(1);
  });

  it('rejects a nonempty seed scope and a polluted sweep scope', () => {
    expect(() => assertEmptyScope([{ title: 'x' }], 'eval')).toThrow(/already has/);
    const memories = [
      { id: 'm1', title: 'A' },
      { id: 'm2', title: 'B' },
    ];
    expect(() =>
      assertFixtureOnlyScope([{ title: 'A' }, { title: 'unrelated' }], memories, 'eval')
    ).toThrow(/not fixture-isolated/);
    expect(() => assertFixtureOnlyScope([{ title: 'A' }], memories, 'eval')).toThrow(/missing/);
    expect(() =>
      assertFixtureOnlyScope([{ title: 'A' }, { title: 'B' }], memories, 'eval')
    ).not.toThrow();
  });
});
