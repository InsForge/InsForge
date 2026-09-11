// Derive a simple crash-loop signal from container lifecycle events.
//
// A healthy machine reports a single `start: started` after launch and stays
// quiet. A boot-looping container (e.g. Node throws on import → Fly restarts
// → throws → restarts) emits a steady cadence of `launch: pending` →
// `start: started` → `exit: stopped` triples roughly every 10s.
//
// The two drivers name the same moment differently: Fly reports `exit: stopped`,
// the Docker driver passes the daemon's own action through as `[container] die`.
// Matching only Fly's wording meant a restart-looping Docker container read as plain
// "running" — the exact failure this file exists to catch.
//
// Detection rule: ≥ 3 exits in the last 60 seconds. This thresholds out one-off
// restarts (deploys, manual stops — a stop is a single `die`) while catching the
// pathological loop.
//
// We compute this client-side because the events are already fetched by the
// existing /api/compute/services/:id/events endpoint — no new backend route or
// derived field on ServiceSchema is needed for the dashboard's purposes.

const CRASH_WINDOW_MS = 60_000;
const CRASH_EXIT_THRESHOLD = 3;

/** Fly's `exit: stopped`, or the Docker daemon's `die` action. */
const EXIT_EVENT = /\bexit:\s*stopped\b|\bdie\b/i;

export interface ServiceHealth {
  isCrashLooping: boolean;
  recentExitCount: number;
}

export interface LifecycleEvent {
  timestamp: number;
  message: string;
}

export function deriveHealth(events: LifecycleEvent[], now: number = Date.now()): ServiceHealth {
  const cutoff = now - CRASH_WINDOW_MS;
  const recentExitCount = events.filter(
    (e) => e.timestamp >= cutoff && EXIT_EVENT.test(e.message)
  ).length;
  return {
    isCrashLooping: recentExitCount >= CRASH_EXIT_THRESHOLD,
    recentExitCount,
  };
}
