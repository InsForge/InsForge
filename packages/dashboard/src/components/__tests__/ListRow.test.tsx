import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ListRow, ListRowCell } from '#components';

describe('ListRow', () => {
  it('makes the inner row clickable with a pointer cursor when onClick is set', () => {
    const onClick = vi.fn();
    const { container } = render(
      <ListRow onClick={onClick}>
        <ListRowCell>Row content</ListRowCell>
      </ListRow>
    );

    const outer = container.firstElementChild as HTMLElement;
    const inner = outer.firstElementChild as HTMLElement;

    // The cursor affordance lives on the inner row, not the outer card, so an
    // optional footer (rendered as a sibling of the row) stays non-interactive.
    expect(inner.className).toContain('cursor-pointer');
    expect(outer.className).not.toContain('cursor-pointer');

    fireEvent.click(inner);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is not interactive when onClick is omitted', () => {
    const { container } = render(
      <ListRow>
        <ListRowCell>Row content</ListRowCell>
      </ListRow>
    );

    const inner = container.firstElementChild!.firstElementChild as HTMLElement;
    expect(inner.className).not.toContain('cursor-pointer');
  });

  it('renders the footer below the row and outside the clickable area', () => {
    const onClick = vi.fn();
    render(
      <ListRow onClick={onClick} footer={<button>Footer action</button>}>
        <ListRowCell>Row content</ListRowCell>
      </ListRow>
    );

    const footerButton = screen.getByRole('button', { name: 'Footer action' });
    fireEvent.click(footerButton);

    // Clicking the footer must not trigger the row's onClick.
    expect(onClick).not.toHaveBeenCalled();
  });

  it('omits the footer node when footer is falsy', () => {
    const { container } = render(
      <ListRow footer={false}>
        <ListRowCell>Row content</ListRowCell>
      </ListRow>
    );

    // Only the inner row, no trailing footer sibling.
    expect(container.firstElementChild!.children).toHaveLength(1);
  });
});

describe('ListRowCell', () => {
  it('applies the default cell padding', () => {
    const { container } = render(<ListRowCell>cell</ListRowCell>);
    expect((container.firstElementChild as HTMLElement).className).toContain('px-2.5');
  });

  it('lets a px override win over the default padding', () => {
    const { container } = render(<ListRowCell className="w-12 px-0">cell</ListRowCell>);
    const cell = container.firstElementChild as HTMLElement;

    expect(cell.className).toContain('px-0');
    expect(cell.className).not.toContain('px-2.5');
  });
});
