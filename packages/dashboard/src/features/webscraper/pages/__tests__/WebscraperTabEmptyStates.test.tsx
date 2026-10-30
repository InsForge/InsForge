import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WebscraperActorsPage } from '#features/webscraper/pages/WebscraperActorsPage';
import { WebscraperRunsPage } from '#features/webscraper/pages/WebscraperRunsPage';
import { WebscraperDatasetPage } from '#features/webscraper/pages/WebscraperDatasetPage';
import type { WebscraperOutletContext } from '#features/webscraper/components/WebscraperLayout';

vi.mock('#features/webscraper/services/webscraper.service', () => ({
  webscraperService: {
    getApifyActors: vi.fn().mockResolvedValue([]),
    getApifyRuns: vi.fn().mockResolvedValue([]),
    getApifyDatasets: vi.fn().mockResolvedValue([]),
  },
}));

// The tabs pick their copy from the host's declared mode. `useDashboardHost`
// stays mocked because WebscraperLayout — imported here for
// `useWebscraperContext` — pulls it in from the same module.
const hostValue: { mode: 'self-hosting' | 'cloud-hosting' } = { mode: 'self-hosting' };
vi.mock('#lib/config/DashboardHostContext', () => ({
  useDashboardHost: () => hostValue,
  useIsCloudHostingMode: () => hostValue.mode === 'cloud-hosting',
}));

// A revoked token is the only state that reaches these messages: the tabs are
// unreachable until a connection exists, and they short-circuit on any status
// other than 'active'.
const revoked: WebscraperOutletContext = {
  connection: {
    apifyUsername: 'carmen',
    plan: 'PERSONAL',
    planTier: 'paid',
    email: 'carmen@example.com',
    dataRetentionDays: 30,
    status: 'revoked',
    createdAt: '2026-03-04T05:06:07.000Z',
  },
  projectId: undefined,
};

function renderPage(page: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/tab']}>
        <Routes>
          <Route element={<Outlet context={revoked} />}>
            <Route path="/tab" element={page} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const pages = [
  {
    name: 'actors',
    element: <WebscraperActorsPage />,
    selfHosted: 'Replace your Apify API token to load actors.',
    cloud: 'Reconnect to load actors.',
  },
  {
    name: 'runs',
    element: <WebscraperRunsPage />,
    selfHosted: 'Replace your Apify API token to load runs.',
    cloud: 'Reconnect to load runs.',
  },
  {
    name: 'datasets',
    element: <WebscraperDatasetPage />,
    selfHosted: 'Replace your Apify API token to load datasets.',
    cloud: 'Reconnect to load datasets.',
  },
];

describe('webscraper tab empty states with a revoked connection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hostValue.mode = 'self-hosting';
  });

  // Regression: all three tabs told a self-hosted admin to "Reconnect", an
  // action that does not exist off-cloud — there is no OAuth and no refresh
  // token, only a replaceable API token.
  it.each(pages)(
    'tells self-hosted admins to replace the token ($name)',
    ({ element, selfHosted, cloud }) => {
      renderPage(element);

      expect(screen.getByText(selfHosted)).toBeInTheDocument();
      expect(screen.queryByText(cloud)).toBeNull();
    }
  );

  it.each(pages)('keeps the cloud reconnect copy ($name)', ({ element, selfHosted, cloud }) => {
    hostValue.mode = 'cloud-hosting';
    renderPage(element);

    expect(screen.getByText(cloud)).toBeInTheDocument();
    expect(screen.queryByText(selfHosted)).toBeNull();
  });
});
