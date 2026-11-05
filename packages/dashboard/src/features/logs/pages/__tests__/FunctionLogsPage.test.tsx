import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { LogSchema } from '@insforge/shared-schemas';
import FunctionLogsPage from '#features/logs/pages/FunctionLogsPage';

const mocks = vi.hoisted(() => ({
  loadMoreLogs: vi.fn(),
  setCurrentPage: vi.fn(),
  logEntries: [
    {
      id: 'orders',
      timestamp: '2026-09-29T10:00:00Z',
      eventMessage: 'POST orders 500 17ms',
      body: { slug: 'orders', status: 500, requestId: 'abc-123', durationMs: 17 },
    },
    {
      id: 'users',
      timestamp: '2026-09-29T11:00:00Z',
      eventMessage: 'GET users 200 3ms',
      body: { slug: 'users', status: 200, requestId: 'def-456', durationMs: 3 },
    },
  ] as LogSchema[],
}));

vi.mock('#features/logs/hooks/useLogs', () => ({
  useLogs: () => ({
    allLogs: mocks.logEntries,
    filteredLogs: mocks.logEntries,
    currentPage: 1,
    setCurrentPage: mocks.setCurrentPage,
    searchQuery: '',
    setSearchQuery: vi.fn(),
    severityFilter: ['error', 'warning', 'informational'],
    setSeverityFilter: vi.fn(),
    isLoading: false,
    error: null,
    getSeverity: () => 'informational',
    hasMore: true,
    isLoadingMore: false,
    loadMoreLogs: mocks.loadMoreLogs,
  }),
}));

vi.mock('#lib/hooks/usePageSize', () => ({
  usePageSize: () => ({ pageSize: 50, pageSizeOptions: [50], onPageSizeChange: vi.fn() }),
}));

vi.mock('#features/logs/components', () => ({
  LogsDataGrid: ({ data }: { data: LogSchema[] }) => (
    <div data-testid="logs-grid">
      {data.map((log) => (
        <div key={log.id}>{log.eventMessage}</div>
      ))}
    </div>
  ),
  SeverityBadge: () => null,
  LogDetailPanel: () => null,
  BuildLogsView: () => null,
  SeverityFilterDropdown: () => null,
}));

vi.mock('#components', () => ({
  TableHeader: () => null,
  EmptyState: () => null,
  DataGridEmptyState: () => null,
}));

describe('FunctionLogsPage', () => {
  it('filters the visible invocations and loads older logs on demand', () => {
    render(<FunctionLogsPage />);

    expect(screen.getByText('POST orders 500 17ms')).toBeInTheDocument();
    expect(screen.getByText('GET users 200 3ms')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Filter by function'), { target: { value: 'orders' } });
    expect(screen.getByText('POST orders 500 17ms')).toBeInTheDocument();
    expect(screen.queryByText('GET users 200 3ms')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: '200' } });
    expect(screen.queryByText('POST orders 500 17ms')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: '500' } });
    expect(screen.getByText('POST orders 500 17ms')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Load older logs' }));
    expect(mocks.loadMoreLogs).toHaveBeenCalledOnce();
  });
});
