import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Input } from '@insforge/ui';

describe('Input', () => {
  it('forwards input props and change events', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<Input aria-label="Project name" placeholder="Name" onChange={onChange} />);

    const input = screen.getByRole('textbox', { name: 'Project name' }) as HTMLInputElement;
    expect(input.placeholder).toBe('Name');

    await user.type(input, 'demo');

    expect(input.value).toBe('demo');
    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it('supports disabled state and custom classes', () => {
    render(<Input aria-label="Disabled input" disabled className="custom-input" />);

    const input = screen.getByRole('textbox', { name: 'Disabled input' }) as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(input.className).toContain('custom-input');
  });
});
