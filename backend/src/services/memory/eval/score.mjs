// Pure scoring helpers for the memory recall eval harness.
// Kept dependency-free so the on-demand scripts and unit tests share one source.

/**
 * Score one query's retrieved fixture ids against its labeled relevant set.
 *
 * `precision` is **list precision** (hits / returned length), not Precision@k.
 * When the vector arm returns fewer than `limit` rows, a single hit scores 1.0.
 * Do not compare list precision across different `limit` values — use MRR.
 *
 * @param {string[]} retrieved fixture ids (or `unknown:…` placeholders)
 * @param {string[]} relevant labeled fixture ids for this query
 */
export function score(retrieved, relevant) {
  const rel = new Set(relevant);
  const hits = retrieved.filter((id) => rel.has(id));
  const precision = retrieved.length ? hits.length / retrieved.length : 0;
  const recall = rel.size ? hits.length / rel.size : 1;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  // List precision is not Precision@k: a short result list can score 1.0.
  // Precision@k is capped at (#relevant / limit), so a single-answer query can
  // never score above 1/limit no matter how good the ranking is. MRR is
  // rank-aware and free of that artifact, so it is the metric to compare across
  // different limits.
  const firstHit = retrieved.findIndex((id) => rel.has(id));
  const rr = firstHit === -1 ? 0 : 1 / (firstHit + 1);
  return { precision, recall, f1, rr, hits, retrieved: retrieved.length };
}

/** Arithmetic mean; empty list → 0. */
export function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/**
 * Aggregate per-query scores into the table row the harness prints.
 * Positive queries drive precision / recall / F1 / MRR; negatives drive noise.
 * @param {Array<{ type: string, relevant: string[] }>} queries
 * @param {Record<string, { precision: number, recall: number, f1: number, rr: number, retrieved: number }>} perQuery
 * @param {number} threshold
 */
export function aggregateRow(queries, perQuery, threshold) {
  const positives = queries.filter((q) => q.relevant.length);
  const negatives = queries.filter((q) => !q.relevant.length);
  const byType = (type) => positives.filter((q) => q.type === type).map((q) => perQuery[q.id].f1);

  return {
    threshold,
    precision: mean(positives.map((q) => perQuery[q.id].precision)),
    recall: mean(positives.map((q) => perQuery[q.id].recall)),
    f1: mean(positives.map((q) => perQuery[q.id].f1)),
    mrr: mean(positives.map((q) => perQuery[q.id].rr)),
    f1Lexical: mean(byType('lexical')),
    f1Semantic: mean(byType('semantic')),
    mrrSemantic: mean(positives.filter((q) => q.type === 'semantic').map((q) => perQuery[q.id].rr)),
    noise: mean(negatives.map((q) => perQuery[q.id].retrieved)),
    perQuery,
  };
}
