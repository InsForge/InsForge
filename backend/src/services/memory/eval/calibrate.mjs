#!/usr/bin/env node
// Where do correct answers actually sit on the cosine scale?
//
// The sweep shows how F1 moves with threshold. This shows why: it prints the
// similarity the service assigns to each query's known-correct memory, so the
// threshold can be read directly off the distribution instead of inferred from
// the metric curve.
//
//   node calibrate.mjs [--scope=eval]
//
// Adapted from ssrajadh/insforge-memory-lab (Apache-2.0).

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { memory } from './client.mjs';
import {
  assertFixtureOnlyScope,
  valueAfterFlag,
  fixtureHitsFromRecall,
  classifyCalibrateTarget,
} from './cli.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const { memories, queries } = JSON.parse(
  readFileSync(resolve(HERE, 'fixtures/corpus.json'), 'utf8')
);

const scope = valueAfterFlag(process.argv, '--scope', 'eval');

const { entries } = await memory.index(scope);
assertFixtureOnlyScope(entries, memories, scope);

const titleToFixture = new Map(memories.map((m) => [m.title, m.id]));

const rows = [];
for (const q of queries.filter((x) => x.relevant.length)) {
  // Public recall() fuses at most 20 vector + 20 keyword hits. Request the
  // schema max so we see as much of that union as the API will return.
  // threshold 1.0 empties the vector arm — those ids are keyword-retained.
  const [{ memories: atZero }, { memories: atKeywordOnly }] = await Promise.all([
    memory.recall({ scope, query: q.query, limit: 50, threshold: 0 }),
    memory.recall({ scope, query: q.query, limit: 50, threshold: 1 }),
  ]);
  const zeroHits = fixtureHitsFromRecall(atZero, titleToFixture);
  const keywordHits = fixtureHitsFromRecall(atKeywordOnly, titleToFixture);
  for (const relId of q.relevant) {
    rows.push({
      query: q.id,
      type: q.type,
      ...classifyCalibrateTarget(relId, zeroHits, keywordHits),
    });
  }
}

console.log('query  type      target  arm              rank  cosine similarity');
console.log('─'.repeat(72));
for (const r of rows) {
  const bar =
    r.similarity === null
      ? '(not retrieved)'
      : '█'.repeat(Math.max(0, Math.round(r.similarity * 40)));
  console.log(
    `${r.query}   ${r.type.padEnd(9)} ${r.target}   ${r.kind.padEnd(16)} ` +
      `${String(r.rank ?? '-').padEnd(5)} ${
        r.similarity === null ? '  —  ' : r.similarity.toFixed(3)
      } ${bar}`
  );
}

const missing = rows.filter((r) => r.kind === 'missing');
const vectorOnly = rows.filter((r) => r.kind === 'vector-only');
const keywordRetained = rows.filter((r) => r.kind === 'keyword-retained');
const byType = (t) => vectorOnly.filter((r) => r.type === t).map((r) => r.similarity);
const stats = (xs) => {
  if (!xs.length) {
    return 'none';
  }
  const sorted = [...xs].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return `min ${Math.min(...xs).toFixed(3)}  median ${median.toFixed(3)}  max ${Math.max(...xs).toFixed(3)}`;
};

console.log(`\nlexical  vector-only: ${stats(byType('lexical'))}`);
console.log(`semantic vector-only: ${stats(byType('semantic'))}`);
if (missing.length) {
  console.log(
    `${missing.length} labeled target(s) were outside the fused recall window ` +
      `(each arm caps at 20). They are omitted from threshold-cut percentages.`
  );
}
if (keywordRetained.length) {
  console.log(
    `${keywordRetained.length} labeled target(s) are keyword-retained (present at threshold 1.0). ` +
      `Raising the vector threshold does not drop them from recall, including same-model ` +
      `hits that sat outside the vector arm's top 20 with a positive fallback cosine.`
  );
}

for (const t of [0.35, 0.4, 0.45, 0.5]) {
  if (!vectorOnly.length) {
    console.log(`threshold ${t}: no vector-only labeled targets to cut`);
    continue;
  }
  const cut = vectorOnly.filter((r) => r.similarity <= t).length;
  console.log(
    `threshold ${t}: cuts ${cut}/${vectorOnly.length} vector-only correct answers ` +
      `(${((cut / vectorOnly.length) * 100).toFixed(0)}%)`
  );
}
