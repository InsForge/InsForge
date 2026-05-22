import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SearchInput } from '@insforge/ui';

describe('SearchInput', () => {
  it('emits immediate and committed changes when debounce is disabled', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onImmediateChange = vi.fn();

    render(
      <SearchInput
        value=""
        onChange={onChange}
        onImmediateChange={onImmediateChange}
        debounceTime={0}
        placeholder="Search projects"
      />
    );

    await user.type(screen.getByRole('textbox'), 'api');

    expect(onImmediateChange).toHaveBeenLastCalledWith('api');
    expect(onChange).toHaveBeenLastCalledWith('api');
  });

  it('clears the current value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onImmediateChange = vi.fn();

    render(
      <SearchInput
        value="api"
        onChange={onChange}
        onImmediateChange={onImmediateChange}
        debounceTime={0}
      />
    );

    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('api');

    await user.click(screen.getByRole('button'));

    expect(input.value).toBe('');
    expect(onImmediateChange).toHaveBeenLastCalledWith('');
    expect(onChange).toHaveBeenLastCalledWith('');
  });
});
