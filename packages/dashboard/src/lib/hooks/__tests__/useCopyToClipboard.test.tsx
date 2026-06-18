import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCopyToClipboard } from '#lib/hooks/useCopyToClipboard';

function stubClipboard(writeText: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
}

describe('useCopyToClipboard', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('copies the text, flips `copied`, and resets it after resetMs', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    const { result } = renderHook(() => useCopyToClipboard(1500));

    let ok!: boolean;
    await act(async () => {
      ok = await result.current.copy('hello');
    });

    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
    expect(result.current.copied).toBe(true);

    // Still set just before the window closes, cleared once it elapses.
    act(() => vi.advanceTimersByTime(1499));
    expect(result.current.copied).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.copied).toBe(false);
  });

  it('returns false and leaves `copied` unset when the write fails', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    stubClipboard(writeText);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => useCopyToClipboard());

    let ok!: boolean;
    await act(async () => {
      ok = await result.current.copy('x');
    });

    expect(ok).toBe(false);
    expect(result.current.copied).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('clears the pending reset timer on unmount', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');

    const { result, unmount } = renderHook(() => useCopyToClipboard());
    await act(async () => {
      await result.current.copy('x');
    });

    // The first copy arms a timer without clearing one (ref starts null),
    // so any clearTimeout after unmount must be the cleanup tearing it down.
    clearSpy.mockClear();
    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });
});
