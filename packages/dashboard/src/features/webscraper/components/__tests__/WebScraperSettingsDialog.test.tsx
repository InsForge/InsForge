import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@insforge/ui';
import { WebScraperSettingsDialog } from '#features/webscraper/components/WebScraperSettingsDialog';

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

const hostValue = { onConnectApify: undefined as undefined | ((id: string) => void) };
vi.mock('#lib/config/DashboardHostContext', () => ({
  useDashboardHost: () => hostValue,
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

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <WebScraperSettingsDialog
          open
          onOpenChange={() => {}}
          connection={connection}
          projectId="p1"
        />
      </ToastProvider>
    </QueryClientProvider>
  );
}

describe('WebScraperSettingsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hostValue.onConnectApify = undefined;
  });

  it('shows the masked token in self-hosting', async () => {
    renderDialog();

    expect(await screen.findByText('apify_ap••••••••mnop')).toBeInTheDocument();
  });

  it('replaces the token', async () => {
    renderDialog();

    await userEvent.click(await screen.findByRole('button', { name: /replace token/i }));
    await userEvent.type(
      screen.getByLabelText(/apify api token/i),
      'apify_api_rotated1234567'
    );
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(updateApifyConfig).toHaveBeenCalledWith('apify_api_rotated1234567')
    );
  });

  it('hides the token controls when the host runs OAuth', async () => {
    hostValue.onConnectApify = vi.fn();
    renderDialog();

    // The account header and the "Account" field row both render the
    // username, so this matches more than one node — use findAllByText
    // instead of the brief's findByText to avoid a false "multiple
    // elements" failure unrelated to the token feature.
    await screen.findAllByText(/carmen/);
    expect(screen.queryByRole('button', { name: /replace token/i })).toBeNull();
  });

  it('does not throw and keeps the dialog open when the save is rejected', async () => {
    updateApifyConfig.mockRejectedValueOnce(new Error('Apify rejected this API token.'));
    renderDialog();

    await userEvent.click(await screen.findByRole('button', { name: /replace token/i }));
    await userEvent.type(
      screen.getByLabelText(/apify api token/i),
      'apify_api_rotated1234567'
    );
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(updateApifyConfig).toHaveBeenCalled());
    // The draft stays put after a rejected save — nothing throws, nothing unmounts.
    expect(screen.getByLabelText(/apify api token/i)).toBeInTheDocument();
  });
});
