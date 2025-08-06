import React, { ReactElement } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from '@/lib/contexts/AuthContext';

// Create a custom render function that includes all providers
interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  initialEntries?: string[];
  queryClient?: QueryClient;
}

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

function AllTheProviders({
  children,
  queryClient = createTestQueryClient(),
}: {
  children: React.ReactNode;
  queryClient?: QueryClient;
}) {
  return (
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>{children}</AuthProvider>
      </QueryClientProvider>
    </BrowserRouter>
  );
}

export function customRender(ui: ReactElement, options?: CustomRenderOptions) {
  const { queryClient, ...renderOptions } = options || {};

  return render(ui, {
    wrapper: ({ children }) => (
      <AllTheProviders queryClient={queryClient}>{children}</AllTheProviders>
    ),
    ...renderOptions,
  });
}

// Re-export everything
export * from '@testing-library/react';
export { customRender as render };

// Test data factories
export const createMockUser = (overrides = {}) => ({
  id: '1',
  email: 'test@example.com',
  name: 'Test User',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  ...overrides,
});

export const createMockTable = (overrides = {}) => ({
  name: 'test_table',
  createdAt: '2024-01-01T00:00:00Z',
  recordCount: 0,
  ...overrides,
});

export const createMockApiResponse = (data: any, options = {}) => ({
  success: true,
  data,
  meta: {},
  ...options,
});

// Mock API responses
export const mockApiSuccess = (data: any) => {
  return Promise.resolve({
    ok: true,
    json: async () => createMockApiResponse(data),
  });
};

export const mockApiError = (message = 'API Error', status = 400) => {
  return Promise.resolve({
    ok: false,
    status,
    json: async () => ({
      success: false,
      error: { message, code: 'ERROR' },
    }),
  });
};
