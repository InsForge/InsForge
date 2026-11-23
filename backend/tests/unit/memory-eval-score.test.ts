import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { score, mean, aggregateRow } from '../../src/services/memory/eval/score.mjs';

const EVAL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../src/services/memory/eval');
const CORPUS_PATH = resolve(EVAL_DIR, 'fixtures/corpus.json');

describe('memory eval score helpers', () => {
  it('scores a perfect ranked hit as precision/recall/F1/MRR = 1', () => {
    expect(score(['m01'], ['m01'])).toEqual({
      precision: 1,
      recall: 1,
      f1: 1,
      rr: 1,
      hits: ['m01'],
      retrieved: 1,
    });
  });

  it('gives reciprocal rank for a later hit and zero when missing', () => {
    expect(score(['x', 'm01'], ['m01']).rr).toBe(0.5);
    expect(score(['x', 'y'], ['m01']).rr).toBe(0);
    expect(score([], ['m01'])).toMatchObject({ precision: 0, recall: 0, f1: 0, rr: 0 });
  });

  it('treats empty relevant as recall=1 so negatives are not double-punished', () => {
    expect(score(['noise'], []).recall).toBe(1);
    expect(score([], []).recall).toBe(1);
  });

  it('averages numbers and returns 0 for an empty list', () => {
    expect(mean([1, 2, 3])).toBe(2);
    expect(mean([])).toBe(0);
  });

  it('aggregates lexical / semantic F1 and negative noise separately', () => {
    const queries = [
      { id: 'q1', type: 'lexical', relevant: ['m1'] },
      { id: 'q2', type: 'semantic', relevant: ['m2'] },
      { id: 'q3', type: 'negative', relevant: [] },
    ];
    const perQuery = {
      q1: { precision: 1, recall: 1, f1: 1, rr: 1, retrieved: 1 },
      q2: { precision: 0.5, recall: 1, f1: 2 / 3, rr: 0.5, retrieved: 2 },
      q3: { precision: 0, recall: 1, f1: 0, rr: 0, retrieved: 3 },
    };
    const row = aggregateRow(queries, perQuery, 0.45);
    expect(row.threshold).toBe(0.45);
    expect(row.precision).toBeCloseTo(0.75);
    expect(row.recall).toBe(1);
    expect(row.f1Lexical).toBe(1);
    expect(row.f1Semantic).toBeCloseTo(2 / 3);
    expect(row.mrrSemantic).toBe(0.5);
    expect(row.noise).toBe(3);
  });
});

describe('memory eval corpus integrity', () => {
  const corpus = JSON.parse(readFileSync(CORPUS_PATH, 'utf8'));
  const memoryIds = new Set(corpus.memories.map((m: { id: string }) => m.id));
  const VALID_KINDS = new Set(['fact', 'decision', 'preference', 'reference']);
  const VALID_TYPES = new Set(['lexical', 'semantic', 'negative']);

  it('has unique memory ids and required fields', () => {
    expect(corpus.memories.length).toBeGreaterThanOrEqual(20);
    expect(memoryIds.size).toBe(corpus.memories.length);
    for (const m of corpus.memories) {
      expect(VALID_KINDS.has(m.kind)).toBe(true);
      expect(m.title.trim().length).toBeGreaterThan(0);
      expect(m.content.trim().length).toBeGreaterThan(0);
    }
  });

  it('has unique query ids with valid labels and relevant references', () => {
    const queryIds = new Set(corpus.queries.map((q: { id: string }) => q.id));
    expect(queryIds.size).toBe(corpus.queries.length);
    expect(corpus.queries.length).toBeGreaterThanOrEqual(10);

    let positives = 0;
    let negatives = 0;
    for (const q of corpus.queries) {
      expect(VALID_TYPES.has(q.type)).toBe(true);
      expect(q.query.trim().length).toBeGreaterThan(0);
      expect(Array.isArray(q.relevant)).toBe(true);
      for (const id of q.relevant) {
        expect(memoryIds.has(id)).toBe(true);
      }
      if (q.relevant.length) {
        positives += 1;
        expect(q.type).not.toBe('negative');
      } else {
        negatives += 1;
        expect(q.type).toBe('negative');
      }
    }
    expect(positives).toBeGreaterThan(0);
    expect(negatives).toBeGreaterThan(0);
  });

  it('includes both lexical and semantic positive queries', () => {
    const types = new Set(
      corpus.queries
        .filter((q: { relevant: string[] }) => q.relevant.length)
        .map((q: { type: string }) => q.type)
    );
    expect(types.has('lexical')).toBe(true);
    expect(types.has('semantic')).toBe(true);
  });
});
