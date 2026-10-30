import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import '#lib/i18n';
import { MetricChartCard } from '#features/dashboard/components/observability/MetricChartCard';

const pts = (pairs: Array<[number, number]>) =>
  pairs.map(([timestamp, value]) => ({ timestamp, value }));

const base = {
  title: 'Test metric',
  icon: <span />,
  rangeSeconds: 3600,
  formatValue: (v: number) => `${v}`,
  isLoading: false,
};

const svgRects = (container: HTMLElement) => [...container.querySelectorAll('svg rect')];

describe('MetricChartCard rendering modes', () => {
  it('barChart mode draws bars instead of the line/area, destructive above the threshold', () => {
    const { container } = render(
      <MetricChartCard
        {...base}
        threshold={60}
        barChart
        data={pts([
          [1000, 10],
          [1060, 90],
          [1120, 20],
        ])}
      />
    );
    expect(container.querySelectorAll('svg path')).toHaveLength(0);
    const rects = svgRects(container);
    expect(rects).toHaveLength(3);
    expect(rects.filter((r) => r.getAttribute('class')?.includes('fill-emerald-300'))).toHaveLength(
      2
    );
    expect(rects.filter((r) => r.getAttribute('class')?.includes('destructive'))).toHaveLength(1);
  });

  it('capacity fallback keeps timestamp-proportional bar placement', () => {
    // Three samples bunched at the window's end: with real-time placement the
    // gaps between bars must be uneven. Equal gaps would mean the fallback
    // was silently remapped onto uniform slots (the r2d2-flagged regression).
    const { container } = render(
      <MetricChartCard
        {...base}
        fixedDomain={[0, 100]}
        formatAxisLabel={(v) => `${v}`}
        capacity={{ ticks: [0, 100], legend: { ceiling: 'Size', used: 'Used' } }}
        data={pts([
          [1000, 50],
          [4400, 60],
          [4600, 70],
        ])}
      />
    );
    const xs = svgRects(container).map((r) => parseFloat(r.getAttribute('x') ?? '0'));
    expect(xs).toHaveLength(3);
    const gaps = [xs[1] - xs[0], xs[2] - xs[1]];
    expect(Math.abs(gaps[0] - gaps[1])).toBeGreaterThan(10);
  });

  it('capacity fallback does not stack the oldest bars on one another', () => {
    // buildSparkline mapped timestamps across the full 434px width and `bars`
    // then clamped with Math.max(Y_AXIS_LABEL_WIDTH + 2, ...). Clamping does not
    // move a sample out of the 29px y-axis gutter, it pins every gutter sample
    // to the same x, so the oldest bars were painted over each other: 5 of 60 at
    // a one-minute cadence. #1919 fixed the uniform-slot modes; this one kept
    // timestamp placement and kept the bug.
    const count = 60;
    const rangeSeconds = 3600;
    const step = rangeSeconds / (count - 1);
    const { container } = render(
      <MetricChartCard
        {...base}
        rangeSeconds={rangeSeconds}
        fixedDomain={[0, 100]}
        formatAxisLabel={(v) => `${v}`}
        capacity={{ ticks: [0, 100], legend: { ceiling: 'Size', used: 'Used' } }}
        data={pts(
          Array.from(
            { length: count },
            (_, i) => [1000 + i * step, 50 + (i % 7)] as [number, number]
          )
        )}
      />
    );
    const xs = svgRects(container).map((r) => parseFloat(r.getAttribute('x') ?? '0'));

    expect(xs).toHaveLength(count);
    expect(new Set(xs).size).toBe(count);
    // And still inside the plot, clear of the y-axis labels.
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(31);
    expect(Math.max(...xs)).toBeLessThanOrEqual(434);
  });

  it('computes AVG/MAX/LATEST from statsData, not the densified display series', () => {
    // Densified data forward-fills one reading into three slots; averaging it
    // would give 15, but the raw readings average 20.
    const { getByText, getAllByText } = render(
      <MetricChartCard
        {...base}
        formatValue={(v) => `V${v}`}
        barChart
        data={pts([
          [1000, 10],
          [1200, 10],
          [1400, 10],
          [1600, 30],
        ])}
        statsData={pts([
          [1000, 10],
          [1600, 30],
        ])}
      />
    );
    expect(getByText('V20')).toBeInTheDocument(); // AVG over raw readings, not slot-weighted V15
    expect(getAllByText('V30').length).toBeGreaterThan(0); // headline / MAX / LATEST
  });

  it('stacked breakdown gives every sample an equal slot with one segment per component', () => {
    const component = (key: string) => ({
      key,
      label: key,
      fillClass: `fill-${key}`,
      data: pts([
        [1000, 10],
        [1300, 10],
        [1600, 10],
        [1900, 10],
      ]),
    });
    const { container } = render(
      <MetricChartCard
        {...base}
        fixedDomain={[0, 100]}
        formatAxisLabel={(v) => `${v}`}
        capacity={{
          ticks: [0, 100],
          legend: { ceiling: 'Size', used: 'Used' },
          components: [component('sys'), component('wal'), component('db')],
        }}
        data={pts([
          [1000, 30],
          [1300, 30],
          [1600, 30],
          [1900, 30],
        ])}
      />
    );
    const rects = svgRects(container);
    expect(rects).toHaveLength(12); // 4 slots × 3 segments
    const xs = rects
      .filter((r) => r.getAttribute('class')?.includes('fill-sys'))
      .map((r) => parseFloat(r.getAttribute('x') ?? '0'))
      .sort((a, b) => a - b);
    const gaps = xs.slice(1).map((x, i) => x - xs[i]);
    for (const gap of gaps) {
      expect(Math.abs(gap - gaps[0])).toBeLessThan(0.01);
    }
  });
});
