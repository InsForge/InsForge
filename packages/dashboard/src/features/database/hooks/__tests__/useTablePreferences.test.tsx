import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_STORAGE_KEYS } from '#lib/utils/constants';
import { useTablePreferences } from '#features/database/hooks/useTablePreferences';

function installLocalStorageMock(): Storage {
  const store = new Map<string, string>();
  const storage = {
    get length() {
      return store.size;
    },
    clear: vi.fn(() => {
      store.clear();
    }),
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(store.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
  } as Storage;

  Object.defineProperty(window, 'localStorage', {
    value: storage,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
  });

  return storage;
}

describe('useTablePreferences', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = installLocalStorageMock();
  });

  afterEach(() => {
    vi.useRealTimers();
    storage.clear();
  });

  it('loads table preferences from the nested schema/table storage object', () => {
    storage.setItem(
      LOCAL_STORAGE_KEYS.databaseTablePreferences,
      JSON.stringify({
        tables: {
          public: {
            profiles: {
              columnWidths: {
                name: 240,
                deleted_column: 100,
              },
              columnOrder: ['email', 'id'],
            },
          },
        },
      })
    );

    const { result } = renderHook(() =>
      useTablePreferences('profiles', 'public', ['id', 'name', 'email'])
    );

    expect(result.current.columnWidths).toEqual({ name: 240 });
    expect(result.current.columnOrder).toEqual(['email', 'id', 'name']);
  });

  it('saves width updates to the nested schema/table storage object', () => {
    vi.useFakeTimers();

    const { result } = renderHook(() =>
      useTablePreferences('profiles', 'public', ['id', 'name', 'email'])
    );

    act(() => {
      result.current.setColumnWidth('name', 260);
      vi.advanceTimersByTime(300);
    });

    expect(
      JSON.parse(storage.getItem(LOCAL_STORAGE_KEYS.databaseTablePreferences) ?? '{}')
    ).toEqual({
      tables: {
        public: {
          profiles: {
            columnWidths: {
              name: 260,
            },
            columnOrder: [],
          },
        },
      },
    });
  });
});
