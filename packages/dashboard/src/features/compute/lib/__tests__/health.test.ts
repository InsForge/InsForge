import { describe, expect, it } from 'vitest';
import { deriveHealth } from '#features/compute/lib/health';

const NOW = 1_700_000_000_000;

function at(secondsAgo: number, message: string) {
  return { timestamp: NOW - secondsAgo * 1000, message };
}

describe('deriveHealth', () => {
  // Fly's wording, which is what the detector was written against.
  it('catches a Fly machine looping on exit: stopped', () => {
    const events = [at(5, 'exit: stopped'), at(15, 'exit: stopped'), at(25, 'exit: stopped')];
    expect(deriveHealth(events, NOW)).toEqual({ isCrashLooping: true, recentExitCount: 3 });
  });

  // Found by pointing the dashboard at a real restart-looping Docker container: it
  // read as plain "running" because the driver passes the daemon's action through as
  // `[container] die`, which the Fly-only pattern did not match.
  it('catches a Docker container looping on [container] die', () => {
    const events = [
      at(1, '[container] start'),
      at(2, '[container] die'),
      at(3, '[container] start'),
      at(4, '[container] die'),
      at(5, '[container] start'),
      at(6, '[container] die'),
    ];
    expect(deriveHealth(events, NOW)).toEqual({ isCrashLooping: true, recentExitCount: 3 });
  });

  // A deliberate stop is one exit. Flagging it would put a crash warning on every
  // service anyone ever stopped.
  it('does not flag a single stop', () => {
    expect(deriveHealth([at(2, '[container] die')], NOW)).toEqual({
      isCrashLooping: false,
      recentExitCount: 1,
    });
  });

  // The window is what separates "looping now" from "restarted a few times today".
  it('ignores exits outside the 60s window', () => {
    const events = [
      at(61, '[container] die'),
      at(120, '[container] die'),
      at(300, 'exit: stopped'),
    ];
    expect(deriveHealth(events, NOW)).toEqual({ isCrashLooping: false, recentExitCount: 0 });
  });

  // `create` and `start` are not exits; counting them would flag a healthy launch.
  it('counts only exits, not the rest of the lifecycle', () => {
    const events = [
      at(1, '[container] create'),
      at(2, '[container] start'),
      at(3, '[image] pull'),
      at(4, 'start: started'),
    ];
    expect(deriveHealth(events, NOW).recentExitCount).toBe(0);
  });
});
