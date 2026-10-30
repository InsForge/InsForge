import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@insforge/ui';
import WebscraperLayout from '#features/webscraper/components/WebscraperLayout';

vi.mock('#assets/icons/terminal.svg?react', () => ({
  default: () => <svg aria-hidden="true" />,
}));

const { getApifyConnection } = vi.hoisted(() => ({
  getApifyConnection: vi.fn(),
}));
vi.mock('#features/webscraper/services/webscraper.service', () => ({
  webscraperService: {
    getApifyConnection,
    getApifyConfig: vi
      .fn()
      .mockResolvedValue({ token: { configured: true, maskedKey: 'apify_ap••••••••mnop' } }),
    updateApifyConfig: vi.fn().mockResolvedValue({
      token: { configured: true, maskedKey: 'apify_ap••••••••wxyz' },
    }),
    disconnectApify: vi.fn().mockResolvedValue(undefined),
  },
}));

const metadata = { projectId: undefined as string | undefined };
vi.mock('#lib/hooks/useMetadata', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#lib/hooks/useMetadata')>();
  return {
    ...actual,
    useProjectId: () => ({
      projectId: metadata.projectId,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    }),
  };
});

const hostValue: {
  mode: string;
  onConnectApify: undefined | ((id: string) => void);
  subscribeApifyConnectionStatus: undefined;
} = {
  mode: 'self-hosting',
  onConnectApify: undefined,
  subscribeApifyConnectionStatus: undefined,
};
vi.mock('#lib/config/DashboardHostContext', () => ({
  useDashboardHost: () => hostValue,
  useIsCloudHostingMode: () => hostValue.mode === 'cloud-hosting',
}));

const activeConnection = {
  apifyUsername: 'carmen',
  plan: 'PERSONAL',
  planTier: 'paid',
  email: 'carmen@example.com',
  dataRetentionDays: 30,
  status: 'active' as const,
  createdAt: '2026-03-04T05:06:07.000Z',
};

function renderLayout() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/dashboard/webscraper/actors']}>
          <WebscraperLayout />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

describe('WebscraperLayout in self-hosting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hostValue.mode = 'self-hosting';
    hostValue.onConnectApify = undefined;
    // Self-hosted deployments leave PROJECT_ID empty by design (.env.example),
    // so GET /api/metadata/project-id answers null.
    metadata.projectId = undefined;
    getApifyConnection.mockResolvedValue(null);
  });

  // Regression: the layout used to bail out to a full-page "Project ID
  // unavailable" ErrorState whenever `useProjectId()` returned nothing. The
  // project id is only ever passed to the cloud OAuth callback, so on a
  // self-hosted install that gate hid the sidebar, the connect panel and the
  // settings gear behind an error the admin could not clear.
  it('renders the connect flow instead of a project-id error', async () => {
    renderLayout();

    expect(await screen.findByLabelText(/apify api token/i)).toBeInTheDocument();
    expect(screen.queryByText(/project id unavailable/i)).toBeNull();
  });

  // The settings gear was disabled on `!projectId`, which is permanently true
  // in self-hosting — a second dead end that only became reachable once the
  // project-id gate above stopped short-circuiting the whole page.
  it('leaves the settings gear usable without a project id', async () => {
    renderLayout();

    await screen.findByLabelText(/apify api token/i);
    expect(screen.getByRole('button', { name: /web scraper config/i })).not.toBeDisabled();
  });

  // Regression: the revoked/degraded banner offered a Reconnect button wired to
  // the cloud OAuth callback, so it was `disabled` forever in self-hosting, and
  // its copy blamed a token refresh that self-hosting does not have.
  it('offers a token form, not a dead Reconnect button, when the token is revoked', async () => {
    getApifyConnection.mockResolvedValue({ ...activeConnection, status: 'revoked' });
    renderLayout();

    expect(await screen.findByLabelText(/apify api token/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^reconnect$/i })).toBeNull();
    expect(screen.queryByText(/token refresh/i)).toBeNull();
  });
});

describe('WebscraperLayout in cloud-hosting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hostValue.mode = 'cloud-hosting';
    hostValue.onConnectApify = vi.fn();
    metadata.projectId = 'p1';
    getApifyConnection.mockResolvedValue(null);
  });

  it('still shows the project-id error when a cloud project has no project id', async () => {
    metadata.projectId = undefined;
    renderLayout();

    expect(await screen.findByText(/project id unavailable/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/apify api token/i)).toBeNull();
  });

  it('keeps the OAuth connect button and no token form', async () => {
    renderLayout();

    expect(await screen.findByRole('button', { name: /connect apify/i })).not.toBeDisabled();
    expect(screen.queryByLabelText(/apify api token/i)).toBeNull();
  });

  it('keeps the enabled Reconnect button and its copy when the connection is revoked', async () => {
    getApifyConnection.mockResolvedValue({ ...activeConnection, status: 'revoked' });
    renderLayout();

    const reconnect = await screen.findByRole('button', { name: /^reconnect$/i });
    expect(reconnect).not.toBeDisabled();
    expect(screen.getByText(/token refresh may have failed/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/apify api token/i)).toBeNull();
  });
});
