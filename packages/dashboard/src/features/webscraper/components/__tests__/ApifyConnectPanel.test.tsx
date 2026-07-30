import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApifyConnectPanel } from '#features/webscraper/components/ApifyConnectPanel';

const { updateApifyConfig } = vi.hoisted(() => ({
  updateApifyConfig: vi.fn().mockResolvedValue({
    token: { configured: true, maskedKey: 'apify_ap••••••••mnop' },
  }),
}));
vi.mock('#features/webscraper/services/webscraper.service', () => ({
  webscraperService: {
    getApifyConfig: vi.fn().mockResolvedValue({ token: { configured: false, maskedKey: null } }),
    updateApifyConfig,
  },
}));

const hostValue = { onConnectApify: undefined as undefined | ((id: string) => void) };
vi.mock('#lib/config/DashboardHostContext', () => ({
  useDashboardHost: () => hostValue,
}));

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ApifyConnectPanel projectId="p1" />
    </QueryClientProvider>
  );
}

describe('ApifyConnectPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hostValue.onConnectApify = undefined;
  });

  it('submits a pasted token when the host offers no OAuth flow', async () => {
    renderPanel();

    await userEvent.type(
      await screen.findByLabelText(/apify api token/i),
      'apify_api_tok1234567890'
    );
    await userEvent.click(screen.getByRole('button', { name: /connect apify/i }));

    await waitFor(() => expect(updateApifyConfig).toHaveBeenCalledWith('apify_api_tok1234567890'));
  });

  it('keeps the token field disabled until something is typed', async () => {
    renderPanel();
    await screen.findByLabelText(/apify api token/i);

    expect(screen.getByRole('button', { name: /connect apify/i })).toBeDisabled();
  });

  it('uses the OAuth button when the host provides one', async () => {
    const onConnectApify = vi.fn();
    hostValue.onConnectApify = onConnectApify;
    renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: /connect apify/i }));

    expect(onConnectApify).toHaveBeenCalledWith('p1');
    expect(screen.queryByLabelText(/apify api token/i)).toBeNull();
  });

  it('shows an inline error and does not throw when the token is rejected', async () => {
    updateApifyConfig.mockRejectedValueOnce(new Error('Apify rejected this API token.'));
    renderPanel();

    await userEvent.type(
      await screen.findByLabelText(/apify api token/i),
      'apify_api_tok1234567890'
    );
    await userEvent.click(screen.getByRole('button', { name: /connect apify/i }));

    expect(await screen.findByText('Apify rejected this API token.')).toBeInTheDocument();
  });
});
