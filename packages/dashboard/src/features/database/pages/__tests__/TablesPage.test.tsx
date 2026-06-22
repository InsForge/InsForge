import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  useTableRecords: vi.fn(),
  useTableSchema: vi.fn(),
  setSelectedSchema: vi.fn(),
}));

vi.mock('#features/database/hooks/useDatabaseSchemaSelection', () => ({
  useDatabaseSchemaSelection: () => ({
    selectedSchema: 'public',
    setSelectedSchema: hookMocks.setSelectedSchema,
  }),
}));

vi.mock('#features/database/hooks/useDatabase', () => ({
  useDatabaseSchemas: () => ({
    schemas: [{ name: 'public', isProtected: false }],
    isLoading: false,
    error: null,
  }),
}));

vi.mock('#features/database/hooks/useTables', () => ({
  useTables: () => ({
    tables: ['tableA', 'tableB'],
    isLoadingTables: false,
    tablesError: null,
    deleteTable: vi.fn(),
    useTableSchema: hookMocks.useTableSchema,
    refetchTables: vi.fn(),
  }),
}));

vi.mock('#features/database/hooks/useRecords', () => ({
  useRecords: () => ({
    useTableRecords: hookMocks.useTableRecords,
    createRecord: vi.fn(),
    updateRecord: vi.fn(),
    deleteRecords: vi.fn(),
    isCreating: false,
    isUpdating: false,
    isDeleting: false,
  }),
}));

vi.mock('#features/database/hooks/useTablePreferences', () => ({
  useTablePreferences: () => ({
    columnOrder: [],
    columnWidths: {},
    reorderColumns: vi.fn(),
    setColumnWidth: vi.fn(),
  }),
}));

vi.mock('#features/database/hooks/useCSVImport', () => ({
  useCSVImport: () => ({
    mutate: vi.fn(),
    isPending: false,
    reset: vi.fn(),
  }),
}));

vi.mock('#features/database/hooks/useCSVExport', () => ({
  useCSVExport: () => ({
    mutate: vi.fn(),
    isPending: false,
    reset: vi.fn(),
  }),
}));

vi.mock('#lib/hooks/usePageSize', () => ({
  usePageSize: () => ({
    pageSize: 50,
    pageSizeOptions: [10, 20, 50, 100],
    onPageSizeChange: vi.fn(),
  }),
}));

vi.mock('#lib/hooks/useConfirm', () => ({
  useConfirm: () => ({
    confirm: vi.fn(),
    confirmDialogProps: {},
  }),
}));

vi.mock('#lib/hooks/useToast', () => ({
  useToast: () => ({
    showToast: vi.fn(),
  }),
}));

vi.mock('#features/database/components/DatabaseSidebar', () => ({
  DatabaseSidebar: (props: { onTableSelect?: (tableName: string) => void }) => (
    <div data-testid="database-sidebar">
      <button onClick={() => props.onTableSelect?.('tableA')}>Switch to Table A</button>
      <button onClick={() => props.onTableSelect?.('tableB')}>Switch to Table B</button>
    </div>
  ),
}));

vi.mock('#features/database/components/DatabaseDataGrid', () => ({
  DatabaseDataGrid: () => <div data-testid="datagrid" />,
}));

vi.mock('#features/database/components/RecordFormDialog', () => ({
  RecordFormDialog: () => null,
}));

vi.mock('#features/database/components/TableForm', () => ({
  TableForm: () => null,
}));

vi.mock('#features/database/components/TablesEmptyState', () => ({
  TablesEmptyState: () => null,
}));

vi.mock('#features/database/components/TemplatePreview', () => ({
  TemplatePreview: () => null,
}));

vi.mock('#components', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div data-testid="alert">{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TableHeader: (props: { searchValue?: string; onSearchChange?: (value: string) => void }) => (
    <div data-testid="table-header">
      <input
        data-testid="search-input"
        value={props.searchValue ?? ''}
        onChange={(e) => props.onSearchChange?.(e.target.value)}
      />
      <span data-testid="search-value-display">{props.searchValue ?? ''}</span>
    </div>
  ),
  EmptyState: ({ title }: { title?: string }) => <div data-testid="empty-state">{title}</div>,
  EmptyStateIllustration: () => null,
  SelectionClearButton: () => null,
  DeleteActionButton: () => null,
}));

vi.mock('@insforge/ui', () => ({
  Button: (props: React.ComponentProps<'button'> & { variant?: string; size?: string }) => (
    <button
      {...props}
      onClick={props.onClick as React.MouseEventHandler<HTMLButtonElement> | undefined}
    >
      {props.children}
    </button>
  ),
  ConfirmDialog: () => null,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('#assets/icons/pencil.svg?react', () => ({
  default: () => null,
}));

vi.mock('#assets/icons/refresh.svg?react', () => ({
  default: () => null,
}));

import TablesPage from '#features/database/pages/TablesPage';

describe('TablesPage table-switch search behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    hookMocks.useTableRecords.mockReturnValue({
      data: { records: [], pagination: { total: 0 } },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    hookMocks.useTableSchema.mockReturnValue({
      data: {
        columns: [
          {
            columnName: 'id',
            type: 'int4',
            isPrimaryKey: true,
            isNullable: false,
            defaultValue: null,
          },
        ],
        recordCount: 0,
      },
      isLoading: false,
      error: null,
    });
  });

  it('clears search input and does not use previous search term when switching tables', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/?table=tableA']}>
        <TablesPage />
      </MemoryRouter>
    );

    const searchInput = screen.getByTestId('search-input');
    await user.type(searchInput, 'test query');

    expect(screen.getByTestId('search-value-display')).toHaveTextContent('test query');

    // useTableRecords should have been called with the search term for tableA
    expect(hookMocks.useTableRecords).toHaveBeenLastCalledWith(
      expect.any(Number),
      expect.any(Number),
      'test query',
      expect.any(Array),
      expect.any(Boolean)
    );

    // Switch to table B
    await user.click(screen.getByRole('button', { name: 'Switch to Table B' }));

    // Search input should be empty
    expect(screen.getByTestId('search-value-display')).toHaveTextContent('');

    // useTableRecords should have been called without the previous search term
    expect(hookMocks.useTableRecords).toHaveBeenLastCalledWith(
      expect.any(Number),
      expect.any(Number),
      '',
      expect.any(Array),
      expect.any(Boolean)
    );
  });

  it('restores previous search value when switching back to a previously searched table', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/?table=tableA']}>
        <TablesPage />
      </MemoryRouter>
    );

    // Search in table A
    const searchInput = screen.getByTestId('search-input');
    await user.type(searchInput, 'tableA query');

    expect(screen.getByTestId('search-value-display')).toHaveTextContent('tableA query');

    // Switch to table B — search should clear
    await user.click(screen.getByRole('button', { name: 'Switch to Table B' }));
    expect(screen.getByTestId('search-value-display')).toHaveTextContent('');

    // Search in table B
    await user.type(screen.getByTestId('search-input'), 'tableB query');
    expect(screen.getByTestId('search-value-display')).toHaveTextContent('tableB query');

    // Switch back to table A
    await user.click(screen.getByRole('button', { name: 'Switch to Table A' }));

    // Should restore tableA's own search value
    await waitFor(() => {
      expect(screen.getByTestId('search-value-display')).toHaveTextContent('tableA query');
    });

    // Records query should use tableA's restored search term
    expect(hookMocks.useTableRecords).toHaveBeenLastCalledWith(
      expect.any(Number),
      expect.any(Number),
      'tableA query',
      expect.any(Array),
      expect.any(Boolean)
    );
  });

  it('shows an empty search input for a table with no prior search', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/?table=tableA']}>
        <TablesPage />
      </MemoryRouter>
    );

    // Initially empty
    expect(screen.getByTestId('search-value-display')).toHaveTextContent('');

    // Search in table A
    await user.type(screen.getByTestId('search-input'), 'a query');

    // Switch to table B (never searched)
    await user.click(screen.getByRole('button', { name: 'Switch to Table B' }));

    // Table B should show empty search
    expect(screen.getByTestId('search-value-display')).toHaveTextContent('');
  });
});
