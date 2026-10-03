# Memory recall eval harness

On-demand evaluation for `MemoryService.recall()` hybrid RRF retrieval.

This is **Phase 1–3** of [InsForge#1908](https://github.com/InsForge/InsForge/issues/1908): a fixture
corpus plus a scoring script, with **injectable** embed model and default recall threshold so
sweeps do not require a source edit. **Phase 3** set the shipped default recall threshold to **0.35**,
derived from the in-repo harness baseline (`results/baseline-limit5.json`). It does **not** change
hybrid RRF retrieval, and it is **not** wired into CI (embedding calls need a live OpenRouter-backed
stack and cost money).

Corpus and harness design adapted from
[ssrajadh/insforge-memory-lab](https://github.com/ssrajadh/insforge-memory-lab) (Apache-2.0).

## Why this exists

`DEFAULT_RECALL_THRESHOLD` in `memory-retrieval.ts` is justified by this harness. Cosine similarity
distributions are not comparable across embedding models, so swapping `EMBED_MODEL` silently
invalidates the constant. Quiet failure mode: recall still returns results, just fewer correct ones.

This harness lets you re-measure precision / recall / F1 / MRR across thresholds, and isolate each
RRF arm through the public API (no DB access, no service patches).

## Layout

```text
eval/
  client.mjs              thin /api/memory HTTP client (API key auth)
  score.mjs               pure precision / recall / F1 / MRR helpers
  harness.mjs             seed · sweep · report
  calibrate.mjs           cosine distribution of correct answers
  fixtures/corpus.json    28 memories + 18 labeled queries
  results/                sweep outputs
                          — baseline-limit5.json is a checked-in aggregates-only reference
                          — live sweeps write results-<scope>-limit<K>.json with per-query detail
```

## Prerequisites

1. Local InsForge stack running (`docker compose up -d` from the repo root).
2. Model Gateway / OpenRouter configured so embeddings succeed.
3. Env for the harness:

```bash
export INSFORGE_URL=http://localhost:7130
export INSFORGE_API_KEY=<project API key>   # GET /api/metadata/api-key
```

## Commands

From this directory:

```bash
node harness.mjs seed    --scope=eval
node harness.mjs sweep   --scope=eval --limit=5
node harness.mjs report  --in results/baseline-limit5.json
node calibrate.mjs       --scope=eval
```

Or from `backend/`:

```bash
npm run memory:eval:seed
npm run memory:eval:sweep
npm run memory:eval:calibrate
npm run memory:eval:report
```

Optional flags:

- `--thresholds=0.35,0.4,0.45,1.0` — per-request vector-arm sweep (no server restart)
- `--limit=3` — change recall `limit` (compare with care; MRR is the cross-limit metric)
- `--embed-model=openai/text-embedding-3-large` — reminder only; set `MEMORY_EMBED_MODEL` on the stack, restart, and re-seed

## Injectable knobs (Phase 2)

The HTTP API already accepts per-request `threshold`. The **default** floor and the embedder used
for writes and queries are process env on InsForge (documented in `.env.example`):

| Env | Default | Notes |
|---|---|---|
| `MEMORY_EMBED_MODEL` | `openai/text-embedding-3-small` | Used for both remember() and recall(). Re-seed after changing. |
| `MEMORY_EMBED_DIMENSIONS` | `1536` | Must match `VECTOR(1536)`. Other widths are rejected. |
| `MEMORY_RECALL_THRESHOLD` | `0.35` | Used when a recall request omits `threshold`. Override via env; other corpora may peak elsewhere. |

Cosine distributions are not comparable across embedding models. Mixing two models in one scope
silently returns junk rankings.

## Arm isolation trick

`threshold` on `recallRequestSchema` gates **only** the vector arm
(`1 - (embedding <=> qv) > $threshold`). Cosine similarity never exceeds 1.0, so
`threshold: 1.0` makes that predicate unsatisfiable: the vector arm matches nothing and the
response is the keyword arm alone. Subtracting the `threshold: 1.0` row from any other row gives
exactly what the vector arm contributed.

## Interpreting results

- Macro-average over **positive** queries only. `precision` is list precision (hits / returned
  length), not Precision@k — compare ranking quality across limits with MRR.
- **Negative** queries report `noise` = mean results returned when the right answer is none.
- `threshold 1.0` is keyword-only; compare it to the shipped default row for vector lift.
  `calibrate.mjs` uses the same ablation: cuts are counted only on vector-only hits
  (present at threshold 0, absent at 1.0) so keyword hits outside the vector top-20
  are not treated as vector-arm losses.
- On `baseline-limit5.json` (text-embedding-3-small, limit=5), 0.35 balances F1 (~0.72), MRR
  (~0.93), and semantic F1 (~0.65) with zero noise. 0.40 trades some recall for a modest precision
  gain; 0.45 drops both precision and F1 versus 0.35. Re-run the harness after changing embed model
  or corpus.
- Seed only into an **empty** scope. Reusing `eval` (or any nonempty scope) pollutes labels.

## Unit tests

Pure scoring helpers are covered by `backend/tests/unit/memory-eval-score.test.ts` (no network).
Corpus integrity is checked in the same file. Live sweeps are manual.
