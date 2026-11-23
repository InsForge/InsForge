#!/usr/bin/env node
// Memory recall eval harness (Phase 1–3 of InsForge#1908; Phase 3 shipped default 0.35).
//
//   node harness.mjs seed    [--scope S]   store the labeled fixture corpus
//   node harness.mjs sweep   [--scope S] [--limit K] [--thresholds a,b,c]
//                              [--embed-model M]  (reminder: set MEMORY_EMBED_MODEL on the stack)
//   node harness.mjs report  [--in results.json]
//
// Thresholds are swept per-request (recallRequestSchema.threshold). The embed
// model is a process env on the InsForge server (MEMORY_EMBED_MODEL) because
// stored vectors must be produced by the same model as query vectors — there
// is no HTTP field that can swap it without re-seeding.
//
// What it measures: precision / recall / F1 / MRR of POST /api/memory/recall
// against a hand-labeled fixture set, swept across recall threshold values.
//
// Run on demand against a local InsForge stack with OPENROUTER configured —
// not in CI (embedding calls cost money and need a live gateway).
//
// Arm isolation, without touching the database:
//   recall()'s vector arm is gated by `1 - (embedding <=> qv) > $threshold`.
//   Cosine similarity never exceeds 1.0, so passing threshold=1.0 makes that
//   predicate unsatisfiable and the vector arm returns the empty set — the
//   fused result is then the KEYWORD ARM ALONE. The keyword arm carries no
//   threshold of its own, so it contributes identically at every threshold.
//   That gives an exact ablation through the public API:
//       keyword-only  = scores at threshold 1.0
//       vector's lift = scores at t  −  scores at 1.0
//
// Metric conventions:
//   - Macro-averaged over POSITIVE queries only (those with a nonempty relevant
//     set). Precision and recall are both undefined on an empty relevant set,
//     and scoring them as 0 would punish the same event twice.
//   - Negative queries are reported separately as a noise rate: the mean number
//     of results returned when the correct answer is "nothing".
//   - A retrieved id that maps to no fixture memory counts as a false positive.
//
// Corpus and harness design adapted from ssrajadh/insforge-memory-lab (Apache-2.0).

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { memory } from './client.mjs';
import { score, aggregateRow } from './score.mjs';
import {
  parseArgs,
  resultFileSlug,
  pickLatestResultFile,
  assertEmptyScope,
  assertFixtureOnlyScope,
} from './cli.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS = resolve(HERE, 'fixtures/corpus.json');
const RESULTS_DIR = resolve(HERE, 'results');

const DEFAULT_THRESHOLDS = [0, 0.2, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.7, 0.8, 1.0];
// Must match DEFAULT_RECALL_THRESHOLD in ../memory-retrieval.ts
const SHIPPED_THRESHOLD = 0.35;

function args() {
  return parseArgs(process.argv.slice(2));
}

const corpus = () => JSON.parse(readFileSync(CORPUS, 'utf8'));

// ---- seeding ----------------------------------------------------------------

async function seed(scope) {
  const { memories } = corpus();
  const { entries: existing } = await memory.index(scope);
  assertEmptyScope(existing, scope);
  console.log(`seeding ${memories.length} memories into empty scope "${scope}"\n`);

  const tally = {};
  for (const m of memories) {
    // Explicit form, not transcript form: the fixture IS the ground truth, so
    // extraction variance must not be in the loop.
    const { results } = await memory.remember({
      scope,
      source: `fixture:${m.id}`,
      kind: m.kind,
      title: m.title,
      content: m.content,
    });
    const action = results[0]?.action ?? 'NONE';
    tally[action] = (tally[action] ?? 0) + 1;
    console.log(`  ${action.padEnd(6)} ${m.id}  ${m.title}`);
  }

  console.log(
    `\n${Object.entries(tally)
      .map(([k, v]) => `${v} ${k}`)
      .join(', ')}`
  );

  // Reconcile can collapse two fixtures into one. That is correct product
  // behaviour but it breaks the 1:1 label mapping, so surface it loudly.
  const { entries } = await memory.index(scope);
  assertFixtureOnlyScope(entries, memories, scope);
  console.log(`\n${entries.length} memories now in scope "${scope}".`);
}

// ---- sweep ------------------------------------------------------------------

async function sweep(scope, limit, thresholds) {
  const { memories, queries } = corpus();

  // Map stored uuid -> fixture id by exact title.
  const { entries } = await memory.index(scope);
  assertFixtureOnlyScope(entries, memories, scope);
  const titleToFixture = new Map(memories.map((m) => [m.title, m.id]));
  const idToFixture = new Map();
  for (const e of entries) {
    const fixtureId = titleToFixture.get(e.title);
    if (fixtureId) {
      idToFixture.set(e.id, fixtureId);
    }
  }

  const positives = queries.filter((q) => q.relevant.length);
  const negatives = queries.filter((q) => !q.relevant.length);
  console.log(
    `scope "${scope}" · ${entries.length} memories · ${positives.length} positive + ` +
      `${negatives.length} negative queries · limit=${limit}\n`
  );

  const rows = [];
  for (const threshold of thresholds) {
    const perQuery = {};
    for (const q of queries) {
      const { memories: got } = await memory.recall({ scope, query: q.query, limit, threshold });
      // Unknown ids stay in the list as false positives rather than vanishing.
      const retrieved = got.map((m) => idToFixture.get(m.id) ?? `unknown:${m.id.slice(0, 8)}`);
      perQuery[q.id] = { ...score(retrieved, q.relevant), retrievedIds: retrieved, type: q.type };
    }

    rows.push(aggregateRow(queries, perQuery, threshold));
    process.stdout.write('.');
  }
  console.log('\n');

  const out = {
    generatedAt: new Date().toISOString(),
    scope,
    limit,
    corpusSize: entries.length,
    queries: { positive: positives.length, negative: negatives.length },
    rows,
  };
  const path = resolve(RESULTS_DIR, `results-${resultFileSlug(scope)}-limit${limit}.json`);
  writeFileSync(path, JSON.stringify(out, null, 2));
  report(out);
  console.log(`\nfull per-query detail written to ${path}`);
}

// ---- reporting --------------------------------------------------------------

const pct = (x) => x.toFixed(3);

function report(data) {
  const { rows } = data;
  console.log(
    'threshold   precision  recall     F1        MRR       F1-lex     F1-sem     MRR-sem    noise'
  );
  console.log('─'.repeat(95));
  for (const r of rows) {
    const mark =
      r.threshold === SHIPPED_THRESHOLD ? ' ←shipped' : r.threshold === 1.0 ? ' ←keyword-only' : '';
    console.log(
      `${String(r.threshold).padEnd(11)} ${pct(r.precision).padEnd(10)} ` +
        `${pct(r.recall).padEnd(10)} ${pct(r.f1).padEnd(9)} ${pct(r.mrr).padEnd(9)} ` +
        `${pct(r.f1Lexical).padEnd(10)} ${pct(r.f1Semantic).padEnd(10)} ` +
        `${pct(r.mrrSemantic).padEnd(10)} ${r.noise.toFixed(2)}${mark}`
    );
  }

  const best = rows.reduce((a, b) => (b.f1 > a.f1 ? b : a));
  const shipped = rows.find((r) => r.threshold === SHIPPED_THRESHOLD);
  const keywordOnly = rows.find((r) => r.threshold === 1.0);

  console.log(`\nbest F1 ${pct(best.f1)} at threshold ${best.threshold}`);
  if (shipped) {
    console.log(`shipped default (${SHIPPED_THRESHOLD}) F1 ${pct(shipped.f1)}`);
  }
  if (keywordOnly) {
    console.log(
      `keyword arm alone F1 ${pct(keywordOnly.f1)} ` +
        `(lexical ${pct(keywordOnly.f1Lexical)}, semantic ${pct(keywordOnly.f1Semantic)})`
    );
    if (shipped) {
      console.log(
        `vector arm's marginal contribution at ${SHIPPED_THRESHOLD}: ` +
          `F1 +${pct(shipped.f1 - keywordOnly.f1)}, ` +
          `semantic F1 +${pct(shipped.f1Semantic - keywordOnly.f1Semantic)}`
      );
    }
  }

  // The headline structural finding, stated only if the data supports it.
  const noiseFloor = Math.min(...rows.map((r) => r.noise));
  const noiseAtMax = keywordOnly?.noise ?? 0;
  if (noiseAtMax > 0 && noiseAtMax >= noiseFloor) {
    console.log(
      `\nNote: the keyword arm carries no threshold, so it still returns ` +
        `${noiseAtMax.toFixed(2)} result(s) per negative query at threshold 1.0. ` +
        `Raising DEFAULT_RECALL_THRESHOLD cannot suppress keyword-arm noise.`
    );
  }
}

// Sweeps are written per scope and per limit, so `report` with no --in picks
// the most recent one rather than guessing a fixed filename.
function latestResults() {
  return pickLatestResultFile(RESULTS_DIR);
}

// ---- main -------------------------------------------------------------------

const a = args();
const scope = a.scope ?? 'eval';
const limit = Number(a.limit ?? 5);
const thresholds = a.thresholds ? a.thresholds.split(',').map(Number) : DEFAULT_THRESHOLDS;

const commands = {
  seed: () => seed(scope),
  sweep: () => sweep(scope, limit, thresholds),
  report: () =>
    report(JSON.parse(readFileSync(a.in ? resolve(process.cwd(), a.in) : latestResults(), 'utf8'))),
};

const cmd = a._[0];
if (!commands[cmd]) {
  console.log(
    'usage: harness.mjs <seed|sweep|report> [--scope=S] [--limit=K] [--thresholds=a,b,c] [--embed-model=M]'
  );
  process.exit(1);
}

if (cmd === 'seed' || cmd === 'sweep') {
  console.log(
    'injection: per-request --thresholds sweep the vector arm over HTTP.\n' +
      '           MEMORY_EMBED_MODEL / MEMORY_RECALL_THRESHOLD / MEMORY_EMBED_DIMENSIONS\n' +
      '           are read by the InsForge process (see .env.example). Changing the\n' +
      '           embedder requires a stack restart and a fresh seed — do not mix models\n' +
      '           in one scope.\n'
  );
  if (a['embed-model']) {
    console.log(
      `requested embed-model=${a['embed-model']} — set MEMORY_EMBED_MODEL to this value ` +
        `on the InsForge stack, restart, then seed a fresh scope.\n`
    );
  }
}

Promise.resolve(commands[cmd]()).catch((err) => {
  console.error(`error: ${err.message}`);
  process.exit(1);
});
