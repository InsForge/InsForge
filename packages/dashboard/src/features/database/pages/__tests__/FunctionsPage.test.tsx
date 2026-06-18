import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '#lib/contexts/ThemeContext';

function createFunctions(num: number) {
  return Array.from({ length: num }, (_, i) => ({
    functionName: `func_${i}`,
    kind: i % 2 === 0 ? 'f' : 'p',
    functionDef: `CREATE FUNCTION func_${i}() RETURNS void LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;`,
  }));
}

const hookMocks = vi.hoisted(() => ({
  schemas: [{ name: 'public' }, { name: 'private' }],
  functions: createFunctions(120),
  searchQuery: '',
  selectedSchema: 'public',
  currentPage: 1,
  pageSize: 50,
  onPageSizeChange: vi.fn(),
  setSelectedSchema: vi.fn(),
  setSearchQuery: vi.fn(),
  setCurrentPage: vi.fn(),
}));

vi.mock('#assets/icons/refresh.svg?react', () => ({
  default: () => <svg data-testid="refresh-icon" />,
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useLocation: () => ({ search: '' }),
    useNavigate: () => vi.fn(),
  };
});

vi.mock('#features/database/hooks/useDatabase', () => ({
  useDatabaseSchemas: () => ({
    schemas: hookMocks.schemas,
    isLoading: false,
  }),
  useFunctions: () => ({
    data: { functions: hookMocks.functions },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('#features/database/hooks/useDatabaseSchemaSelection', () => ({
  useDatabaseSchemaSelection: () => ({
    selectedSchema: hookMocks.selectedSchema,
    setSelectedSchema: hookMocks.setSelectedSchema,
  }),
}));

vi.mock('#lib/hooks/usePageSize', () => ({
  usePageSize: () => ({
    pageSize: hookMocks.pageSize,
    pageSizeOptions: [50, 100, 250, 500],
    onPageSizeChange: hookMocks.onPageSizeChange,
  }),
}));

import FunctionsPage from '#features/database/pages/FunctionsPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <ThemeProvider forcedTheme="light">
        <FunctionsPage />
      </ThemeProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  const store = new Map<string, string>();
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key) => store.get(key) ?? null);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key, value) => store.set(key, value));
  vi.spyOn(Storage.prototype, 'clear').mockImplementation(() => store.clear());
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FunctionsPage pagination', () => {
  beforeEach(() => {
    hookMocks.functions = createFunctions(120);
    hookMocks.searchQuery = '';
    hookMocks.selectedSchema = 'public';
    hookMocks.currentPage = 1;
    hookMocks.pageSize = 50;
    hookMocks.onPageSizeChange = vi.fn();
    hookMocks.setSelectedSchema = vi.fn();
    hookMocks.setSearchQuery = vi.fn();
    hookMocks.setCurrentPage = vi.fn();
  });

  it('renders pagination for 120 functions (3 pages with pageSize=50)', () => {
    renderPage();
    expect(screen.getByText(/of 120 functions/i)).toBeInTheDocument();
  });

  it('shows correct record count when all rows fit in one page', () => {
    hookMocks.functions = createFunctions(30);
    renderPage();
    expect(screen.getByText(/of 30 functions/i)).toBeInTheDocument();
  });

  it('renders page navigation buttons', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Go to first page' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to previous page' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to next page' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to last page' })).toBeInTheDocument();
  });

  it('disables previous and first page buttons on page 1', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Go to first page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Go to previous page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Go to next page' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Go to last page' })).toBeEnabled();
  });

  it('renders empty state when no functions exist', () => {
    hookMocks.functions = [];
    renderPage();
    expect(screen.getByText('No functions found')).toBeInTheDocument();
  });

  it('shows per-page selector', () => {
    renderPage();
    expect(screen.getByText(/Functions per page/i)).toBeInTheDocument();
  });

  it('navigates to page 2 when user clicks the page-2 button', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Go to page 2' }));
    expect(screen.getByText(/Showing 51 to 100 of 120/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to page 2' })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });

  it('shows single page when data exactly equals pageSize', () => {
    hookMocks.functions = createFunctions(50);
    renderPage();
    expect(screen.getByText(/of 50 functions/i)).toBeInTheDocument();
  });

  it('shows single-item last page when data is pageSize+1', () => {
    hookMocks.functions = createFunctions(51);
    renderPage();
    expect(screen.getByText(/of 51 functions/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to next page' })).toBeEnabled();
  });
});
