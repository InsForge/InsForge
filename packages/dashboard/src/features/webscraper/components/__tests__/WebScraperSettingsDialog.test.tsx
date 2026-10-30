import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@insforge/ui';
import { WebScraperSettingsDialog } from '#features/webscraper/components/WebScraperSettingsDialog';
import { ApifyConnectPanel } from '#features/webscraper/components/ApifyConnectPanel';

vi.mock('#assets/icons/terminal.svg?react', () => ({
  default: () => <svg aria-hidden="true" />,
}));

const { updateApifyConfig } = vi.hoisted(() => ({
  updateApifyConfig: vi.fn().mockResolvedValue({
    token: { configured: true, maskedKey: 'apify_ap••••••••wxyz' },
  }),
}));
vi.mock('#features/webscraper/services/webscraper.service', () => ({
  webscraperService: {
    getApifyConfig: vi
      .fn()
      .mockResolvedValue({ token: { configured: true, maskedKey: 'apify_ap••••••••mnop' } }),
    updateApifyConfig,
    disconnectApify: vi.fn().mockResolvedValue(undefined),
  },
}));

// `mode` is what the dialog reads to decide self-hosted vs cloud;
// `onConnectApify` is only the callback the cloud branch invokes. The cloud
// shell always supplies both together, so the fixtures set them together too.
const hostValue: {
  mode: 'self-hosting' | 'cloud-hosting';
  onConnectApify: undefined | ((id: string) => void);
} = { mode: 'self-hosting', onConnectApify: undefined };
vi.mock('#lib/config/DashboardHostContext', () => ({
  useDashboardHost: () => hostValue,
  useIsCloudHostingMode: () => hostValue.mode === 'cloud-hosting',
}));

const connection = {
  apifyUsername: 'carmen',
  plan: 'PERSONAL',
  planTier: 'paid',
  email: 'carmen@example.com',
  dataRetentionDays: 30,
  status: 'active' as const,
  createdAt: '2026-03-04T05:06:07.000Z',
};

function renderDialog({
  connection: connectionOverride = connection,
}: { connection?: typeof connection | null } = {}) {
  // Default parameters only fall back on `undefined`, not on `null` — unlike
  // `??`, which would treat an explicitly-passed `connection: null` the same
  // as "not provided" and silently render the wrong (connected) branch.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <WebScraperSettingsDialog
          open
          onOpenChange={() => {}}
          connection={connectionOverride}
          projectId="p1"
        />
      </ToastProvider>
    </QueryClientProvider>
  );
}

describe('WebScraperSettingsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hostValue.mode = 'self-hosting';
    hostValue.onConnectApify = undefined;
  });

  it('hides the token controls when the host runs OAuth', async () => {
    hostValue.mode = 'cloud-hosting';
    hostValue.onConnectApify = vi.fn();
    renderDialog();

    // The account header and the "Account" field row both render the
    // username, so this matches more than one node — use findAllByText
    // instead of the brief's findByText to avoid a false "multiple
    // elements" failure unrelated to the token feature.
    await screen.findAllByText(/carmen/);
    expect(screen.queryByRole('button', { name: /replace token/i })).toBeNull();
  });

  it('shows a working token entry form when self-hosted and not yet connected', async () => {
    renderDialog({ connection: null });

    // Reachability: WebscraperSidebar's gear button opens this dialog even
    // when disconnected (disabled only on `!projectId`), so self-hosted
    // admins land here with `connection === null` before ever configuring a
    // token. There must be a real way forward, not a dead end: typing a
    // token must enable the submit button (unlike the old bug, where the
    // one and only button was permanently disabled because `onConnectApify`
    // is never defined in self-hosting).
    const tokenInput = await screen.findByLabelText(/apify api token/i);
    const connectButton = screen.getByRole('button', { name: /connect apify/i });
    expect(connectButton).toBeDisabled();

    await userEvent.type(tokenInput, 'apify_api_tok1234567890');
    expect(connectButton).not.toBeDisabled();
  });

  it('shows the enabled OAuth button (no token input) when the host runs OAuth and is not yet connected', async () => {
    hostValue.mode = 'cloud-hosting';
    hostValue.onConnectApify = vi.fn();
    renderDialog({ connection: null });

    const connectButton = await screen.findByRole('button', { name: /connect apify/i });
    expect(connectButton).not.toBeDisabled();
    expect(screen.queryByLabelText(/apify api token/i)).toBeNull();
  });

  it('gives each mounted ApifyTokenForm a distinct input id when both surfaces are on screen at once', async () => {
    // Reachability: WebscraperLayout renders ApifyConnectPanel in the main
    // pane whenever `connection` is null, and WebscraperSidebar's settings
    // gear (rendered unconditionally alongside that pane) opens
    // WebScraperSettingsDialog as an overlay rather than replacing the page
    // underneath it. A disconnected self-hosted admin can therefore have
    // both ApifyTokenForm instances mounted simultaneously. Each must get
    // its own id or the two <label>/<input> pairs collide.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <ApifyConnectPanel projectId="p1" />
          <WebScraperSettingsDialog open onOpenChange={() => {}} connection={null} projectId="p1" />
        </ToastProvider>
      </QueryClientProvider>
    );

    const tokenInputs = await screen.findAllByLabelText(/apify api token/i);
    expect(tokenInputs).toHaveLength(2);
    const ids = tokenInputs.map((input) => input.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids[0]).not.toBe('');
    expect(ids[1]).not.toBe('');
  });
});
