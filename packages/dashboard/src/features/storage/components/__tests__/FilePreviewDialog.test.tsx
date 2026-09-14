import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FilePreviewDialog } from '#features/storage/components/FilePreviewDialog';
import type { StorageFileSchema } from '@insforge/shared-schemas';

const fileA: StorageFileSchema = {
  key: 'images/a.png',
  bucket: 'test-bucket',
  size: 1024,
  mimeType: 'image/png',
  uploadedAt: '2026-06-16T00:00:00.000Z',
  url: 'https://example.test/api/storage/buckets/test-bucket/objects/images%2Fa.png',
};

const fileB: StorageFileSchema = {
  key: 'docs/b.pdf',
  bucket: 'test-bucket',
  size: 2048,
  mimeType: 'application/pdf',
  uploadedAt: '2026-06-16T00:00:00.000Z',
  url: 'https://example.test/api/storage/buckets/test-bucket/objects/docs%2Fb.pdf',
};

// One stable function: the dialog's preview effect depends on downloadObject, so
// a fresh vi.fn() per render re-runs the effect forever and never leaves loading.
const { downloadObject } = vi.hoisted(() => ({ downloadObject: vi.fn() }));
downloadObject.mockResolvedValue(new Blob(['mock']));

vi.mock('#features/storage/hooks/useStorageObjects', () => ({
  useStorageObjects: () => ({ downloadObject }),
}));

describe('FilePreviewDialog', () => {
  it('renders previous and next buttons when callbacks are provided', () => {
    render(
      <FilePreviewDialog
        open
        onOpenChange={vi.fn()}
        file={fileA}
        bucket="test-bucket"
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        hasPrevious
        hasNext
      />
    );

    expect(screen.getByRole('button', { name: 'Previous file' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next file' })).toBeInTheDocument();
  });

  it('hides navigation buttons when no callbacks are provided', () => {
    render(<FilePreviewDialog open onOpenChange={vi.fn()} file={fileA} bucket="test-bucket" />);

    expect(screen.queryByRole('button', { name: 'Previous file' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next file' })).not.toBeInTheDocument();
  });

  it('disables previous button at the first file', () => {
    render(
      <FilePreviewDialog
        open
        onOpenChange={vi.fn()}
        file={fileA}
        bucket="test-bucket"
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        hasPrevious={false}
        hasNext
      />
    );

    expect(screen.getByRole('button', { name: 'Previous file' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next file' })).not.toBeDisabled();
  });

  it('disables next button at the last file', () => {
    render(
      <FilePreviewDialog
        open
        onOpenChange={vi.fn()}
        file={fileB}
        bucket="test-bucket"
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        hasPrevious
        hasNext={false}
      />
    );

    expect(screen.getByRole('button', { name: 'Next file' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous file' })).not.toBeDisabled();
  });

  it('calls onNext when next button is clicked', async () => {
    const onNext = vi.fn();
    const user = userEvent.setup();

    render(
      <FilePreviewDialog
        open
        onOpenChange={vi.fn()}
        file={fileA}
        bucket="test-bucket"
        onPrevious={vi.fn()}
        onNext={onNext}
        hasPrevious
        hasNext
      />
    );

    await user.click(screen.getByRole('button', { name: 'Next file' }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('calls onPrevious when previous button is clicked', async () => {
    const onPrevious = vi.fn();
    const user = userEvent.setup();

    render(
      <FilePreviewDialog
        open
        onOpenChange={vi.fn()}
        file={fileB}
        bucket="test-bucket"
        onPrevious={onPrevious}
        onNext={vi.fn()}
        hasPrevious
        hasNext
      />
    );

    await user.click(screen.getByRole('button', { name: 'Previous file' }));
    expect(onPrevious).toHaveBeenCalledTimes(1);
  });

  it('navigates with ArrowRight key when open and hasNext', () => {
    const onNext = vi.fn();

    render(
      <FilePreviewDialog
        open
        onOpenChange={vi.fn()}
        file={fileA}
        bucket="test-bucket"
        onPrevious={vi.fn()}
        onNext={onNext}
        hasPrevious
        hasNext
      />
    );

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('navigates with ArrowLeft key when open and hasPrevious', () => {
    const onPrevious = vi.fn();

    render(
      <FilePreviewDialog
        open
        onOpenChange={vi.fn()}
        file={fileB}
        bucket="test-bucket"
        onPrevious={onPrevious}
        onNext={vi.fn()}
        hasPrevious
        hasNext
      />
    );

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(onPrevious).toHaveBeenCalledTimes(1);
  });

  it('does not call onNext on ArrowRight when hasNext is false', () => {
    const onNext = vi.fn();

    render(
      <FilePreviewDialog
        open
        onOpenChange={vi.fn()}
        file={fileB}
        bucket="test-bucket"
        onPrevious={vi.fn()}
        onNext={onNext}
        hasPrevious
        hasNext={false}
      />
    );

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(onNext).not.toHaveBeenCalled();
  });

  it('does not call onPrevious on ArrowLeft when hasPrevious is false', () => {
    const onPrevious = vi.fn();

    render(
      <FilePreviewDialog
        open
        onOpenChange={vi.fn()}
        file={fileA}
        bucket="test-bucket"
        onPrevious={onPrevious}
        onNext={vi.fn()}
        hasPrevious={false}
        hasNext
      />
    );

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(onPrevious).not.toHaveBeenCalled();
  });

  it('disables both buttons when only one file (no previous and no next)', () => {
    render(
      <FilePreviewDialog
        open
        onOpenChange={vi.fn()}
        file={fileA}
        bucket="test-bucket"
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        hasPrevious={false}
        hasNext={false}
      />
    );

    expect(screen.getByRole('button', { name: 'Previous file' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next file' })).toBeDisabled();
  });

  it('does not respond to keyboard navigation when dialog is closed', () => {
    const onNext = vi.fn();

    render(
      <FilePreviewDialog
        open={false}
        onOpenChange={vi.fn()}
        file={fileA}
        bucket="test-bucket"
        onPrevious={vi.fn()}
        onNext={onNext}
        hasPrevious
        hasNext
      />
    );

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(onNext).not.toHaveBeenCalled();
  });

  // Text masking doesn't hide media. ph-no-capture on the preview container is
  // what keeps customer file contents out of PostHog session replays.
  describe('session replay privacy', () => {
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;

    beforeEach(() => {
      URL.createObjectURL = vi.fn(() => 'blob:mock-preview');
      URL.revokeObjectURL = vi.fn();
    });

    afterEach(() => {
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    });

    it('renders image previews inside a ph-no-capture container', async () => {
      render(<FilePreviewDialog open onOpenChange={vi.fn()} file={fileA} bucket="test-bucket" />);

      const image = await screen.findByRole('img', { name: 'a.png' });
      expect(image.closest('.ph-no-capture')).not.toBeNull();
    });

    it('renders PDF previews inside a ph-no-capture container', async () => {
      render(<FilePreviewDialog open onOpenChange={vi.fn()} file={fileB} bucket="test-bucket" />);

      const frame = await screen.findByTitle('b.pdf');
      expect(frame.tagName).toBe('IFRAME');
      expect(frame.closest('.ph-no-capture')).not.toBeNull();
    });
  });
});
