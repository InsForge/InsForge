import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Calendar } from '@insforge/ui';

const NOVEMBER_2026 = new Date(2026, 10, 1);

describe('Calendar', () => {
  it('renders the month it is pointed at', () => {
    render(<Calendar mode="single" defaultMonth={NOVEMBER_2026} />);

    expect(screen.getByText('November 2026')).toBeTruthy();
    expect(screen.getByRole('button', { name: /November 10th, 2026/ })).toBeTruthy();
  });

  it('reports the day that was clicked', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(<Calendar mode="single" defaultMonth={NOVEMBER_2026} onSelect={onSelect} />);

    await user.click(screen.getByRole('button', { name: /November 10th, 2026/ }));

    expect(onSelect).toHaveBeenCalled();
    const [picked] = onSelect.mock.calls[0] as [Date];
    expect(picked.getFullYear()).toBe(2026);
    expect(picked.getMonth()).toBe(10);
    expect(picked.getDate()).toBe(10);
  });

  it('marks the selected day, which is the classNames contract this wrapper owns', () => {
    render(
      <Calendar mode="single" defaultMonth={NOVEMBER_2026} selected={new Date(2026, 10, 10)} />
    );

    // react-day-picker puts the `selected` classNames on the gridcell, which is why this wrapper
    // reaches through to the button inside it. Assert the cell, since a `[&>button]` variant leaves
    // its class on the cell and only the CSS it generates lands on the button.
    const day = screen.getByRole('button', { name: /November 10th, 2026/ });
    const cell = day.closest('td');
    expect(cell?.className).toContain('[&>button]:text-[rgb(var(--inverse))]');
    expect(cell?.getAttribute('aria-selected')).toBe('true');
  });

  it('moves months from the nav, so the Chevron override stays wired up', async () => {
    const user = userEvent.setup();

    render(<Calendar mode="single" defaultMonth={NOVEMBER_2026} />);

    await user.click(screen.getByRole('button', { name: /previous/i }));

    expect(screen.getByText('October 2026')).toBeTruthy();
  });
});
