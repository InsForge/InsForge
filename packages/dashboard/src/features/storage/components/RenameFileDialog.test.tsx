import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@insforge/ui', () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogBody: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogCloseButton: (props: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      Close
    </button>
  ),
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

import { RenameFileDialog } from './RenameFileDialog';

describe('RenameFileDialog', () => {
  const onOpenChange = vi.fn();
  const onRename = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prefills the basename and submits the new name', async () => {
    onRename.mockResolvedValueOnce(undefined);

    render(
      <RenameFileDialog
        open={true}
        onOpenChange={onOpenChange}
        onRename={onRename}
        file={{
          bucket: 'assets',
          key: 'folder/photo.png',
          size: 10,
          mimeType: 'image/png',
          uploadedAt: '2026-03-31T12:00:00.000Z',
          url: '/photo.png',
        }}
      />
    );

    const input = screen.getByLabelText('File Name');
    expect(input).toHaveValue('photo.png');

    fireEvent.change(input, { target: { value: 'cover.png' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));

    await waitFor(() => {
      expect(onRename).toHaveBeenCalledWith('cover.png');
    });
  });

  it('shows a validation error for an empty name', async () => {
    render(
      <RenameFileDialog
        open={true}
        onOpenChange={onOpenChange}
        onRename={onRename}
        file={{
          bucket: 'assets',
          key: 'photo.png',
          size: 10,
          mimeType: 'image/png',
          uploadedAt: '2026-03-31T12:00:00.000Z',
          url: '/photo.png',
        }}
      />
    );

    const input = screen.getByLabelText('File Name');
    fireEvent.change(input, { target: { value: '   ' } });

    const submitButton = screen.getByRole('button', { name: 'Rename' });
    expect(submitButton).toBeDisabled();
    expect(onRename).not.toHaveBeenCalled();
  });

  it.each([
    { value: '.', message: 'Invalid file name' },
    { value: '..', message: 'Invalid file name' },
    { value: 'folder/cover.png', message: 'File name cannot contain "/" or "\\\\"' },
  ])('rejects invalid rename input: $value', async ({ value, message }) => {
    render(
      <RenameFileDialog
        open={true}
        onOpenChange={onOpenChange}
        onRename={onRename}
        file={{
          bucket: 'assets',
          key: 'photo.png',
          size: 10,
          mimeType: 'image/png',
          uploadedAt: '2026-03-31T12:00:00.000Z',
          url: '/photo.png',
        }}
      />
    );

    const input = screen.getByLabelText('File Name');
    fireEvent.change(input, { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));

    await waitFor(() => {
      expect(screen.getByText(message.replace('\\\\', '\\'))).toBeInTheDocument();
    });
    expect(onRename).not.toHaveBeenCalled();
  });
});
