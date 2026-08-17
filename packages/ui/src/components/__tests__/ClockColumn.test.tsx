import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ClockColumn } from '@insforge/ui';

// jsdom has no layout, so it ships no scrollIntoView; the column calls it on the selected row.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe('ClockColumn', () => {
  it('reports the unit that was picked', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();

    render(<ClockColumn options={['00', '01', '02']} selected="01" onPick={onPick} />);

    await user.click(screen.getByRole('button', { name: '02' }));

    expect(onPick).toHaveBeenCalledWith('02');
  });

  it('marks only the selected unit, and scrolls it into view', () => {
    render(<ClockColumn options={['00', '01', '02']} selected="01" onPick={vi.fn()} />);

    // The selected row is the one carrying the inverted fill.
    const selected = screen.getByRole('button', { name: '01' });
    const other = screen.getByRole('button', { name: '00' });
    expect(selected.className).toContain('var(--foreground)');
    expect(other.className).not.toContain('var(--foreground)');
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('marks nothing when the selection is not among the options', () => {
    render(<ClockColumn options={['00', '01']} selected="" onPick={vi.fn()} />);

    for (const unit of ['00', '01']) {
      expect(screen.getByRole('button', { name: unit }).className).not.toContain(
        'var(--foreground)'
      );
    }
  });
});
