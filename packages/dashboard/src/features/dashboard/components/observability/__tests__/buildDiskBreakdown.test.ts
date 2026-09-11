import { describe, expect, it } from 'vitest';
import {
  buildDiskBreakdown,
  densifyDiskBreakdown,
} from '#features/dashboard/components/observability/ObservabilitySection';

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

  it('drops samples with no nearby used reading instead of fabricating System as zero', () => {
    const breakdown = buildDiskBreakdown(
      pts([
        [1000, 30],
        [5000, 30],
      ]),
      pts([
        [1000, 20],
        [5000, 20],
      ]),
      pts([[1000, 100]])
    );
    expect(breakdown!.database.map((p) => p.timestamp)).toEqual([1000]);
  });

  it('returns null when no sample has a nearby used reading', () => {
    expect(buildDiskBreakdown(pts([[5000, 30]]), pts([[5000, 20]]), pts([[1000, 100]]))).toBeNull();
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
});

describe('densifyDiskBreakdown', () => {
  it.each([
    ['1h', 3600],
    ['6h', 21600],
    ['24h', 86400],
    ['3d', 259200],
  ] as const)('includes the newest sample for %s range', (range, windowSeconds) => {
    const newestTimestamp = windowSeconds;

    const breakdown = {
      database: pts([
        [0, 100],
        [windowSeconds - 900, 200],
        [newestTimestamp, 500],
      ]),
      wal: pts([
        [0, 10],
        [windowSeconds - 900, 20],
        [newestTimestamp, 50],
      ]),
      system: pts([
        [0, 1000],
        [windowSeconds - 900, 1100],
        [newestTimestamp, 1400],
      ]),
    };

    const result = densifyDiskBreakdown(breakdown, range);
    const lastPoint = result.database[result.database.length - 1];

    expect(lastPoint).toEqual({
      timestamp: newestTimestamp,
      value: 500,
    });
  });

  it.each([
    ['1-minute cadence', 60],
    ['15-minute cadence', 900],
  ] as const)('includes the newest sample with %s', (_label, cadence) => {
    const newestTimestamp = 3600;

    const breakdown = {
      database: pts([
        [newestTimestamp - cadence * 2, 100],
        [newestTimestamp - cadence, 200],
        [newestTimestamp, 500],
      ]),
      wal: pts([
        [newestTimestamp - cadence * 2, 10],
        [newestTimestamp - cadence, 20],
        [newestTimestamp, 50],
      ]),
      system: pts([
        [newestTimestamp - cadence * 2, 1000],
        [newestTimestamp - cadence, 1100],
        [newestTimestamp, 1400],
      ]),
    };

    const result = densifyDiskBreakdown(breakdown, '1h');
    const lastPoint = result.database[result.database.length - 1];

    expect(lastPoint).toEqual({
      timestamp: newestTimestamp,
      value: 500,
    });
  });

  it('preserves the source timestamp for the newest sample', () => {
    const breakdown = {
      database: pts([
        [0, 100],
        [3600, 500],
      ]),
      wal: pts([
        [0, 10],
        [3600, 50],
      ]),
      system: pts([
        [0, 1000],
        [3600, 1400],
      ]),
    };

    const result = densifyDiskBreakdown(breakdown, '1h');
    const lastPoint = result.database[result.database.length - 1];

    expect(lastPoint.timestamp).toBe(3600);
    expect(lastPoint.value).toBe(500);
  });
});
