import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FunctionRow } from '../FunctionRow';
import type { FunctionSchema } from '@insforge/shared-schemas';

const mockFunction: FunctionSchema = {
  id: 'func_1',
  slug: 'hello-world',
  name: 'Hello World',
  description: 'Test function',
  code: 'export default () => new Response("ok")',
  status: 'active',
  createdAt: '2026-03-12T20:00:00.000Z',
  updatedAt: '2026-03-12T20:00:00.000Z',
  deployedAt: '2026-03-12T20:00:00.000Z',
};

describe('FunctionRow', () => {
  it('opens the function detail view when the row is clicked', () => {
    const onClick = vi.fn();
    const onDelete = vi.fn();

    render(
      <FunctionRow
        function={mockFunction}
        onClick={onClick}
        onDelete={onDelete}
        deploymentUrl="https://functions.example.com"
      />
    );

    fireEvent.click(screen.getByText('Hello World'));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('triggers delete without opening the detail view when the delete button is clicked', () => {
    const onClick = vi.fn();
    const onDelete = vi.fn();

    render(
      <FunctionRow
        function={mockFunction}
        onClick={onClick}
        onDelete={onDelete}
        deploymentUrl="https://functions.example.com"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete function Hello World' }));

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });
});
