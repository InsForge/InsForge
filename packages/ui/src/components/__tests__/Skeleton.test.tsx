import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Skeleton } from '@insforge/ui';

describe('Skeleton', () => {
  it('renders a pulsing placeholder with forwarded native attributes', () => {
    const { container } = render(<Skeleton className="h-8 w-56" aria-hidden="true" />);

    const skeleton = container.firstElementChild as HTMLElement;
    expect(skeleton.className).toContain('animate-pulse');
    expect(skeleton.className).toContain('h-8');
    expect(skeleton.className).toContain('w-56');
    expect(skeleton.getAttribute('aria-hidden')).toBe('true');
  });
});
