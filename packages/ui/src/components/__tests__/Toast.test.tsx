import * as React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast, useUploadToast } from '@insforge/ui';

function ToastControls() {
  const { showToast, toast } = useToast();

  return (
    <>
      <button type="button" onClick={() => showToast('Saved', 'success')}>
        Show positional toast
      </button>
      <button type="button" onClick={() => showToast('Careful', { variant: 'warning' })}>
        Show options toast
      </button>
      <button type="button" onClick={() => toast.error('Failed')}>
        Show helper toast
      </button>
    </>
  );
}

function UploadToastControls() {
  const { showUploadToast, updateUploadProgress } = useUploadToast();
  const toastIdRef = React.useRef<string | null>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          toastIdRef.current = showUploadToast(2);
        }}
      >
        Show upload toast
      </button>
      <button
        type="button"
        onClick={() => {
          if (toastIdRef.current) {
            updateUploadProgress(toastIdRef.current, 100);
          }
        }}
      >
        Complete upload
      </button>
    </>
  );
}

describe('ToastProvider', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('supports positional, options-object, and helper toast APIs', () => {
    render(
      <ToastProvider>
        <ToastControls />
      </ToastProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Show positional toast' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show options toast' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show helper toast' }));

    expect(screen.getByText('Saved')).toBeTruthy();
    expect(screen.getByText('Careful')).toBeTruthy();
    expect(screen.getByText('Failed')).toBeTruthy();
  });

  it('auto-dismisses completed upload toasts after the completion delay', () => {
    vi.useFakeTimers();

    render(
      <ToastProvider>
        <UploadToastControls />
      </ToastProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Show upload toast' }));
    expect(screen.getByText('2 files uploading')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Complete upload' }));

    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(screen.queryByText('2 files uploading')).toBeNull();
  });

  it('preserves positional icon and duration when options is omitted', () => {
    function PositionalControls() {
      const { showToast } = useToast();
      return (
        <button
          type="button"
          onClick={() =>
            showToast('Positional', undefined, <span data-testid="custom-icon" />, 5000)
          }
        >
          Show positional args
        </button>
      );
    }

    const { container } = render(
      <ToastProvider>
        <PositionalControls />
      </ToastProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Show positional args' }));

    expect(screen.getByTestId('custom-icon')).toBeTruthy();
    const bar = container.querySelector<HTMLElement>('.animate-toast-progress');
    expect(bar?.style.animationDuration).toBe('5000ms');
  });

  it('re-applies the tone default duration when updateToast changes the variant', () => {
    function VariantControls() {
      const { showToast, updateToast } = useToast();
      const idRef = React.useRef<string | null>(null);
      return (
        <>
          <button
            type="button"
            onClick={() => {
              idRef.current = showToast('Promotable', 'info');
            }}
          >
            Create info toast
          </button>
          <button
            type="button"
            onClick={() => {
              if (idRef.current) {
                updateToast(idRef.current, { variant: 'success' });
              }
            }}
          >
            Promote to success
          </button>
        </>
      );
    }

    const { container } = render(
      <ToastProvider>
        <VariantControls />
      </ToastProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create info toast' }));
    expect(
      container.querySelector<HTMLElement>('.animate-toast-progress')?.style.animationDuration
    ).toBe('3000ms');

    fireEvent.click(screen.getByRole('button', { name: 'Promote to success' }));
    expect(
      container.querySelector<HTMLElement>('.animate-toast-progress')?.style.animationDuration
    ).toBe('2000ms');
  });

  it('clamps upload progress to the 0-100 range', () => {
    function OverflowUploadControls() {
      const { showUploadToast, updateUploadProgress } = useUploadToast();
      const idRef = React.useRef<string | null>(null);
      return (
        <>
          <button
            type="button"
            onClick={() => {
              idRef.current = showUploadToast(1);
            }}
          >
            Start upload
          </button>
          <button
            type="button"
            onClick={() => {
              if (idRef.current) {
                updateUploadProgress(idRef.current, 150);
              }
            }}
          >
            Overflow progress
          </button>
          <button
            type="button"
            onClick={() => {
              if (idRef.current) {
                updateUploadProgress(idRef.current, Number.NaN);
              }
            }}
          >
            NaN progress
          </button>
          <button
            type="button"
            onClick={() => {
              if (idRef.current) {
                updateUploadProgress(idRef.current, Number.POSITIVE_INFINITY);
              }
            }}
          >
            Infinite progress
          </button>
        </>
      );
    }

    const { container } = render(
      <ToastProvider>
        <OverflowUploadControls />
      </ToastProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Start upload' }));
    fireEvent.click(screen.getByRole('button', { name: 'Overflow progress' }));

    const uploadBar = container.querySelector<HTMLElement>('.bg-neutral-700');
    expect(uploadBar?.style.width).toBe('100%');

    fireEvent.click(screen.getByRole('button', { name: 'NaN progress' }));
    expect(uploadBar?.style.width).toBe('0%');

    fireEvent.click(screen.getByRole('button', { name: 'Infinite progress' }));
    expect(uploadBar?.style.width).toBe('0%');
  });
});
