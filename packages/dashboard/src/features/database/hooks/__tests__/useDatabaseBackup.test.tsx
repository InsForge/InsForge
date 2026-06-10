import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { DashboardHostProvider } from '#lib/config/DashboardHostContext';
import {
  useDatabaseBackupActions,
  useDatabaseBackupInfo,
} from '#features/database/hooks/useDatabaseBackup';
import { backupService } from '#features/database/services/backup.service';

vi.mock('#features/database/services/backup.service', () => ({
  backupService: {
    listBackups: vi.fn(),
    createBackup: vi.fn(),
    renameBackup: vi.fn(),
    deleteBackup: vi.fn(),
    restoreBackup: vi.fn(),
  },
}));

const listBackupsMock = vi.mocked(backupService.listBackups);
const createBackupMock = vi.mocked(backupService.createBackup);
const restoreBackupMock = vi.mocked(backupService.restoreBackup);

function makeBackup(overrides: Record<string, unknown> = {}) {
  return {
    id: 'backup-1',
    name: 'nightly',
    triggerSource: 'manual' as const,
    status: 'completed' as const,
    sizeBytes: 100,
    errorMessage: null,
    createdAt: '2026-06-10T00:00:00.000Z',
    completedAt: '2026-06-10T00:01:00.000Z',
    createdBy: 'admin',
    ...overrides,
  };
}

function createWrapper(hostValue: Parameters<typeof DashboardHostProvider>[0]['value']) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <DashboardHostProvider value={hostValue}>{children}</DashboardHostProvider>
      </QueryClientProvider>
    );
  };
}

describe('useDatabaseBackupInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches backups from the OSS backend in self-hosting mode', async () => {
    listBackupsMock.mockResolvedValue({
      backups: [
        makeBackup(),
        makeBackup({ id: 'backup-2', name: null, triggerSource: 'scheduled' }),
      ],
    });

    const { result } = renderHook(() => useDatabaseBackupInfo(), {
      wrapper: createWrapper({ mode: 'self-hosting' }),
    });

    await waitFor(() => {
      expect(result.current.backupInfo).not.toBeNull();
    });

    expect(result.current.backupInfo?.manualBackups).toEqual([
      expect.objectContaining({ id: 'backup-1', name: 'nightly', triggerSource: 'manual' }),
    ]);
    expect(result.current.backupInfo?.scheduledBackups).toEqual([
      expect.objectContaining({ id: 'backup-2', triggerSource: 'scheduled' }),
    ]);
  });

  it('uses the host callback in cloud-hosting mode', async () => {
    const onRequestBackupInfo = vi.fn().mockResolvedValue({
      manualBackups: [],
      scheduledBackups: [],
    });

    const { result } = renderHook(() => useDatabaseBackupInfo(), {
      wrapper: createWrapper({ mode: 'cloud-hosting', onRequestBackupInfo }),
    });

    await waitFor(() => {
      expect(result.current.backupInfo).toEqual({ manualBackups: [], scheduledBackups: [] });
    });

    expect(onRequestBackupInfo).toHaveBeenCalled();
    expect(listBackupsMock).not.toHaveBeenCalled();
  });
});

describe('useDatabaseBackupActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls the OSS backend in self-hosting mode and omits empty names', async () => {
    createBackupMock.mockResolvedValue(makeBackup());
    restoreBackupMock.mockResolvedValue({ message: 'ok' });

    const { result } = renderHook(() => useDatabaseBackupActions(), {
      wrapper: createWrapper({ mode: 'self-hosting' }),
    });

    await result.current.createBackup?.('  my backup  ');
    expect(createBackupMock).toHaveBeenCalledWith('my backup');

    await result.current.createBackup?.('   ');
    expect(createBackupMock).toHaveBeenLastCalledWith(undefined);

    await result.current.restoreBackup?.('backup-1');
    expect(restoreBackupMock).toHaveBeenCalledWith('backup-1');
  });

  it('returns the host callbacks in cloud-hosting mode', () => {
    const onCreateBackup = vi.fn();
    const onRestoreBackup = vi.fn();

    const { result } = renderHook(() => useDatabaseBackupActions(), {
      wrapper: createWrapper({ mode: 'cloud-hosting', onCreateBackup, onRestoreBackup }),
    });

    expect(result.current.createBackup).toBe(onCreateBackup);
    expect(result.current.restoreBackup).toBe(onRestoreBackup);
    expect(result.current.renameBackup).toBeUndefined();
  });
});
