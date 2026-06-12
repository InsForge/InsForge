import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LoadingState } from '@insforge/ui';

describe('LoadingState', () => {
  it('renders the default message with a spinner', () => {
    const { container } = render(<LoadingState />);

    expect(screen.getByText('Loading...')).toBeDefined();
    expect(container.querySelector('.animate-spin')).not.toBeNull();
  });

  it('renders a custom message and merges className', () => {
    const { container } = render(<LoadingState message="Loading Analytics…" className="py-0" />);

    expect(screen.getByText('Loading Analytics…')).toBeDefined();
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('py-0');
    expect(root.className).not.toContain('py-12');
  });
});
