import { describe, expect, it } from 'vitest';
import { buildDiskBreakdown } from '#features/dashboard/components/observability/ObservabilitySection';

const pts = (pairs: Array<[number, number]>) =>
  pairs.map(([timestamp, value]) => ({ timestamp, value }));

describe('buildDiskBreakdown', () => {
  it('derives System as nearest-used minus database minus wal', () => {
    const breakdown = buildDiskBreakdown(
      pts([
        [1000, 30],
        [1300, 40],
      ]),
      pts([
        [1000, 20],
        [1300, 20],
      ]),
      pts([
        [990, 100],
        [1290, 100],
      ])
    );
    expect(breakdown).not.toBeNull();
    expect(breakdown!.system.map((p) => p.value)).toEqual([50, 40]);
  });

  it('clamps System at zero when used underruns the components', () => {
    const breakdown = buildDiskBreakdown(pts([[1000, 30]]), pts([[1000, 20]]), pts([[1000, 0]]));
    expect(breakdown!.system[0].value).toBe(0);
  });

  it('returns null when no used sample is nearby so unmetered disks do not fabricate System', () => {
    const breakdown = buildDiskBreakdown(pts([[5000, 30]]), pts([[5000, 20]]), pts([[1000, 100]]));
    expect(breakdown).toBeNull();
  });

  it('returns null without breakdown series — older backend and self-host fall back', () => {
    expect(buildDiskBreakdown(undefined, undefined, pts([[1000, 100]]))).toBeNull();
    expect(buildDiskBreakdown(pts([[1000, 1]]), undefined, [])).toBeNull();
    expect(buildDiskBreakdown([], [], [])).toBeNull();
  });

  it('drops database samples with no matching wal timestamp', () => {
    const breakdown = buildDiskBreakdown(
      pts([
        [1000, 30],
        [1300, 40],
      ]),
      pts([[1000, 20]]),
      pts([[1000, 100]])
    );
    expect(breakdown!.database).toHaveLength(1);
    expect(breakdown!.database[0].timestamp).toBe(1000);
  });

  it('handles mixed series with missing used samples, keeping valid samples timestamp-aligned across database, wal, and system', () => {
    const breakdown = buildDiskBreakdown(
      pts([
        [1000, 30],
        [2000, 40],
        [3000, 50],
      ]),
      pts([
        [1000, 20],
        [2000, 20],
        [3000, 20],
      ]),
      pts([
        [1000, 100],
        [3000, 150],
      ])
    );
    expect(breakdown).not.toBeNull();
    expect(breakdown!.database.map((p) => p.timestamp)).toEqual([1000, 3000]);
    expect(breakdown!.wal.map((p) => p.timestamp)).toEqual([1000, 3000]);
    expect(breakdown!.system.map((p) => p.timestamp)).toEqual([1000, 3000]);
    expect(breakdown!.system.map((p) => p.value)).toEqual([50, 80]);
  });
});
