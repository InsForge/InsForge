import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Database } from 'lucide-react';
import { EmptyState } from '@insforge/ui';

describe('EmptyState', () => {
  it('renders title, description, and a working action button', async () => {
    const onClick = vi.fn();
    render(
      <EmptyState
        title="No tables yet"
        description="Create your first table to get started."
        action={{ label: 'Create table', onClick }}
      />
    );

    expect(screen.getByRole('heading', { name: 'No tables yet' })).toBeDefined();
    expect(screen.getByText('Create your first table to get started.')).toBeDefined();

    await userEvent.click(screen.getByRole('button', { name: 'Create table' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders an image when no icon is given', () => {
    render(<EmptyState title="Empty" image="/empty.svg" />);

    const img = screen.getByRole('img', { name: 'Empty' }) as HTMLImageElement;
    expect(img.src).toContain('/empty.svg');
  });

  it('prefers the icon over image and visual', () => {
    render(
      <EmptyState
        title="Empty"
        icon={Database}
        image="/empty.svg"
        visual={<span data-testid="custom-visual" />}
      />
    );

    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByTestId('custom-visual')).toBeNull();
  });

  it('renders an arbitrary visual when no icon or image is given', () => {
    render(<EmptyState title="Empty" visual={<span data-testid="custom-visual" />} />);

    expect(screen.getByTestId('custom-visual')).toBeDefined();
  });
});
