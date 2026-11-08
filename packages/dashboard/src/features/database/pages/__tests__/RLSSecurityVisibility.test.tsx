import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TablesPage from '#features/database/pages/TablesPage';
import PoliciesPage from '#features/database/pages/PoliciesPage';

const hookMocks = vi.hoisted(() => ({
  useTableRecords: vi.fn(),
  useTableSchema: vi.fn(),
  usePolicies: vi.fn(),
  useAllTableSchemas: vi.fn(),
  enableTableRLS: vi.fn(),
  confirm: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('#features/database/hooks/useDatabaseSchemaSelection', () => ({
  useDatabaseSchemaSelection: () => ({
    selectedSchema: 'public',
    setSelectedSchema: vi.fn(),
  }),
}));

vi.mock('#features/database/hooks/useDatabase', () => ({
  useDatabaseSchemas: () => ({
    schemas: [{ name: 'public', isProtected: false }],
    isLoading: false,
    error: null,
  }),
  usePolicies: () => hookMocks.usePolicies(),
}));

vi.mock('#features/database/hooks/useTables', () => ({
  useTables: () => ({
    tables: ['notes', 'todos'],
    isLoadingTables: false,
    tablesError: null,
    deleteTable: vi.fn(),
    enableTableRLS: hookMocks.enableTableRLS,
    isEnablingRLS: false,
    useTableSchema: hookMocks.useTableSchema,
    refetchTables: vi.fn(),
  }),
  useAllTableSchemas: () => hookMocks.useAllTableSchemas(),
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
    confirm: hookMocks.confirm,
    confirmDialogProps: {},
  }),
}));

vi.mock('@insforge/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@insforge/ui')>();
  return {
    ...actual,
    useToast: () => ({
      showToast: hookMocks.showToast,
    }),
  };
});

vi.mock('#assets/icons/pencil.svg?react', () => ({
  default: () => null,
}));

vi.mock('#assets/icons/refresh.svg?react', () => ({
  default: () => null,
}));

vi.mock('#features/database/components/DatabaseSidebar', () => ({
  DatabaseSidebar: () => <div data-testid="database-sidebar" />,
  DatabaseStudioSidebarPanel: () => <div data-testid="studio-sidebar" />,
}));

vi.mock('#features/database/components/DatabaseDataGrid', () => ({
  DatabaseDataGrid: () => <div data-testid="datagrid" />,
}));

vi.mock('#components', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#components')>();
  return {
    ...actual,
    DataGrid: () => <div data-testid="policies-datagrid" />,
    DataGridEmptyState: () => <div data-testid="datagrid-empty" />,
  };
});

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

vi.mock('#features/database/components/DatabaseSchemaSelect', () => ({
  DatabaseSchemaSelect: () => <div data-testid="schema-select" />,
}));

vi.mock('#features/database/components/SQLModal', () => ({
  SQLModal: () => null,
  SQLCellButton: () => null,
}));

describe('RLS Security Visibility in Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    hookMocks.useTableRecords.mockReturnValue({
      data: { records: [], totalRecords: 0 },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    hookMocks.usePolicies.mockReturnValue({
      data: { policies: [] },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    hookMocks.confirm.mockResolvedValue(true);
  });

  describe('TablesPage RLS visibility', () => {
    it('displays warning alert and badge when rlsEnabled is false', async () => {
      hookMocks.useTableSchema.mockReturnValue({
        data: {
          tableName: 'notes',
          schemaName: 'public',
          columns: [{ columnName: 'title', type: 'string', isNullable: false, isUnique: false }],
          recordCount: 0,
          rlsEnabled: false,
        },
        isLoading: false,
      });

      render(
        <MemoryRouter initialEntries={['/dashboard/database/tables?table=notes']}>
          <TablesPage />
        </MemoryRouter>
      );

      // Warning text should be visible
      expect(
        screen.getByText(
          /Row-Level Security is disabled for this table. Database roles with table privileges may access all rows through the data API./i
        )
      ).toBeInTheDocument();

      // Badge should show RLS Off
      expect(screen.getByText('RLS Off')).toBeInTheDocument();

      // Enable RLS button should be present
      const enableButton = screen.getByRole('button', { name: /Enable RLS/i });
      expect(enableButton).toBeInTheDocument();

      // Clicking Enable RLS triggers confirm dialog and mutation
      await userEvent.click(enableButton);
      expect(hookMocks.confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Enable Row-Level Security?',
          destructive: false,
        })
      );
      expect(hookMocks.enableTableRLS).toHaveBeenCalledWith('notes');
    });

    it('does not display warning alert or RLS Off badge when rlsEnabled is true', () => {
      hookMocks.useTableSchema.mockReturnValue({
        data: {
          tableName: 'todos',
          schemaName: 'public',
          columns: [{ columnName: 'title', type: 'string', isNullable: false, isUnique: false }],
          recordCount: 0,
          rlsEnabled: true,
        },
        isLoading: false,
      });

      render(
        <MemoryRouter initialEntries={['/dashboard/database/tables?table=todos']}>
          <TablesPage />
        </MemoryRouter>
      );

      expect(
        screen.queryByText(/Row-Level Security is disabled for this table/i)
      ).not.toBeInTheDocument();
      expect(screen.queryByText('RLS Off')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Enable RLS/i })).not.toBeInTheDocument();
    });
  });

  describe('PoliciesPage RLS visibility', () => {
    it('displays warning alert listing tables with RLS disabled', () => {
      hookMocks.useAllTableSchemas.mockReturnValue({
        allSchemas: [
          { tableName: 'notes', schemaName: 'public', rlsEnabled: false },
          { tableName: 'todos', schemaName: 'public', rlsEnabled: true },
        ],
        isLoading: false,
      });

      render(
        <MemoryRouter initialEntries={['/dashboard/database/policies']}>
          <PoliciesPage />
        </MemoryRouter>
      );

      expect(
        screen.getByText(/Row-Level Security is disabled for 1 table in this schema/i)
      ).toBeInTheDocument();

      // Table name 'notes' should be listed in the banner
      expect(screen.getByRole('button', { name: 'notes' })).toBeInTheDocument();
      // 'todos' has RLS enabled, so it should not be listed as an affected table
      expect(screen.queryByRole('button', { name: 'todos' })).not.toBeInTheDocument();
    });

    it('does not display warning alert when all tables have RLS enabled', () => {
      hookMocks.useAllTableSchemas.mockReturnValue({
        allSchemas: [
          { tableName: 'notes', schemaName: 'public', rlsEnabled: true },
          { tableName: 'todos', schemaName: 'public', rlsEnabled: true },
        ],
        isLoading: false,
      });

      render(
        <MemoryRouter initialEntries={['/dashboard/database/policies']}>
          <PoliciesPage />
        </MemoryRouter>
      );

      expect(screen.queryByText(/Row-Level Security is disabled for/i)).not.toBeInTheDocument();
    });
  });
});
