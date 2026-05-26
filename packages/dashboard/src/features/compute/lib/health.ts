// Derive a simple crash-loop signal from Fly machine lifecycle events.
//
// A healthy machine reports a single `start: started` after launch and stays
// quiet. A boot-looping container (e.g. Node throws on import → Fly restarts
// → throws → restarts) emits a steady cadence of `launch: pending` →
// `start: started` → `exit: stopped` triples roughly every 10s.
//
// Detection rule: ≥ 3 `exit: stopped` events in the last 60 seconds. This
// thresholds out one-off restarts (deploys, manual stops) while catching the
// pathological loop that today reads as plain "running" on the dashboard.
//
// We compute this client-side because the events are already fetched by the
// existing /api/compute/services/:id/events endpoint — no new backend route or
// derived field on ServiceSchema is needed for the dashboard's purposes.

const CRASH_WINDOW_MS = 60_000;
const CRASH_EXIT_THRESHOLD = 3;

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
    (e) => e.timestamp >= cutoff && /\bexit:\s*stopped\b/i.test(e.message)
  ).length;
  return {
    isCrashLooping: recentExitCount >= CRASH_EXIT_THRESHOLD,
    recentExitCount,
  };
}
