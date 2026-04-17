import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

    fireEvent.submit(submitButton.closest('form') as HTMLFormElement);

    await waitFor(() => {
      expect(screen.getByText('File name is required')).toBeInTheDocument();
    });
    expect(onRename).not.toHaveBeenCalled();
  });
});
