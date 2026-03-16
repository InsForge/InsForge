import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTableColumnWidthsPreference } from '../useTableColumnWidthsPreference';

describe('useTableColumnWidthsPreference', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('debounces localStorage writes during resize', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    const { result } = renderHook(() => useTableColumnWidthsPreference('users', ['name']));

    act(() => {
      result.current.setColumnWidth('name', 200);
      vi.advanceTimersByTime(50);
      result.current.setColumnWidth('name', 220);
      vi.advanceTimersByTime(50);
      result.current.setColumnWidth('name', 240);
    });

    expect(setItemSpy).not.toHaveBeenCalled();

    act(() => {
      vi.runAllTimers();
    });

    expect(setItemSpy).toHaveBeenCalledTimes(1);

    const persistedValue = setItemSpy.mock.calls[0]?.[1];
    expect(persistedValue).toBeDefined();

    const parsed = JSON.parse(String(persistedValue)) as {
      tableColumnWidths: Record<string, Record<string, number>>;
    };
    expect(parsed.tableColumnWidths.users.name).toBe(240);
  });

  it('flushes pending width save on unmount', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    const { result, unmount } = renderHook(() => useTableColumnWidthsPreference('users', ['name']));

    act(() => {
      result.current.setColumnWidth('name', 260);
    });

    expect(setItemSpy).not.toHaveBeenCalled();

    unmount();

    expect(setItemSpy).toHaveBeenCalledTimes(1);

    const persistedValue = setItemSpy.mock.calls[0]?.[1];
    expect(persistedValue).toBeDefined();

    const parsed = JSON.parse(String(persistedValue)) as {
      tableColumnWidths: Record<string, Record<string, number>>;
    };
    expect(parsed.tableColumnWidths.users.name).toBe(260);
  });

  it('commits width to state only after resize becomes idle', () => {
    const { result } = renderHook(() => useTableColumnWidthsPreference('users', ['name']));

    expect(result.current.columnWidths).toEqual({});

    act(() => {
      result.current.setColumnWidth('name', 200);
      vi.advanceTimersByTime(100);
      result.current.setColumnWidth('name', 220);
      vi.advanceTimersByTime(100);
      result.current.setColumnWidth('name', 240);
    });

    // Resize events only update refs before idle timeout; no React state commit yet.
    expect(result.current.columnWidths).toEqual({});

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current.columnWidths).toEqual({ name: 240 });
  });

  it('batches multiple columns resized in quick succession', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    const { result } = renderHook(() =>
      useTableColumnWidthsPreference('users', ['name', 'email'])
    );

    act(() => {
      result.current.setColumnWidth('name', 150);
      vi.advanceTimersByTime(50);
      result.current.setColumnWidth('email', 300);
      vi.advanceTimersByTime(50);
      result.current.setColumnWidth('name', 180);
    });

    expect(setItemSpy).not.toHaveBeenCalled();
    expect(result.current.columnWidths).toEqual({});

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(setItemSpy).toHaveBeenCalledTimes(1);
    expect(result.current.columnWidths).toEqual({ name: 180, email: 300 });
  });

  it('unmount flush persists to localStorage without updating state', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    const { result, unmount } = renderHook(() =>
      useTableColumnWidthsPreference('users', ['name'])
    );

    act(() => {
      result.current.setColumnWidth('name', 400);
    });

    const widthsBeforeUnmount = result.current.columnWidths;
    expect(widthsBeforeUnmount).toEqual({});

    unmount();

    expect(setItemSpy).toHaveBeenCalledTimes(1);
    // columnWidths should still reflect the pre-flush state (no setState on unmount)
    expect(widthsBeforeUnmount).toEqual({});
  });

  it('does not persist when width is unchanged from committed value', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    const { result } = renderHook(() => useTableColumnWidthsPreference('users', ['name']));

    act(() => {
      result.current.setColumnWidth('name', 250);
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(setItemSpy).toHaveBeenCalledTimes(1);
    setItemSpy.mockClear();

    // Set the same width again — should be a no-op
    act(() => {
      result.current.setColumnWidth('name', 250);
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(setItemSpy).not.toHaveBeenCalled();
  });
});
