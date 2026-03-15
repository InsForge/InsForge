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
});
