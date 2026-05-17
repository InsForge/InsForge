import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from '@insforge/ui';

describe('Button', () => {
  it('renders a styled button with forwarded native attributes', () => {
    render(
      <Button type="submit" variant="secondary" size="lg" disabled className="custom-button">
        Save
      </Button>
    );

    const button = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(button.type).toBe('submit');
    expect(button.disabled).toBe(true);
    expect(button.className).toContain('custom-button');
    expect(button.className).toContain('bg-card');
    expect(button.className).toContain('h-9');
  });

  it('renders the child element when asChild is enabled', () => {
    render(
      <Button asChild>
        <a href="/docs">Docs</a>
      </Button>
    );

    const link = screen.getByRole('link', { name: 'Docs' }) as HTMLAnchorElement;
    expect(link.href).toContain('/docs');
    expect(link.className).toContain('inline-flex');
  });
});
