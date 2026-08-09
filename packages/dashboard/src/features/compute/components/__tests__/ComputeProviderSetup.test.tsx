import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@insforge/ui';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// The Fly panel embeds the credentials form, which reads its status through
// react-query. Stub the transport so the test stays about the panel's content.
vi.mock('#features/compute/services/compute.service', () => ({
  computeServicesApi: {
    getConfig: () =>
      Promise.resolve({
        flyApiToken: { configured: false, masked: null, source: null },
        flyOrg: { configured: false, masked: null, source: null },
      }),
    updateConfig: vi.fn(),
  },
}));

import { ComputeProviderSetup } from '#features/compute/components/ComputeProviderSetup';

// Same providers WebScraperSettingsDialog's test wraps with: the embedded form reads
// react-query and reports save failures through the toast context.
function renderPanel(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>
  );
}

describe('ComputeProviderSetup', () => {
  // Per provider, because the steps genuinely differ: Docker is a compose edit,
  // Fly is two credentials. One generic screen would bury whichever the operator
  // actually wants.
  it('walks through the Docker steps, not Fly’s', () => {
    renderPanel(<ComputeProviderSetup provider="docker" />);

    expect(screen.getByText(/is not enabled yet/i)).toBeTruthy();
    expect(screen.getByText(/Mount the Docker socket/i)).toBeTruthy();
    expect(screen.getByText(/^Set your host/i)).toBeTruthy();
    expect(screen.getByText('docker-compose.yml')).toBeTruthy();
    expect(screen.queryByText(/FLY_API_TOKEN/)).toBeNull();
  });

  it('walks through the Fly steps, not Docker’s', () => {
    renderPanel(<ComputeProviderSetup provider="fly" />);

    expect(screen.getByText(/is not enabled yet/i)).toBeTruthy();
    expect(screen.getByText(/Create a token/i)).toBeTruthy();
    expect(screen.queryByText('docker-compose.yml')).toBeNull();
  });

  // The socket path is the single most useful diagnostic when a mount is missing.
  it('names the socket path it is looking for when known', () => {
    renderPanel(<ComputeProviderSetup provider="docker" socketPath="/run/user/1000/docker.sock" />);

    expect(screen.getByText(/\/run\/user\/1000\/docker\.sock/)).toBeTruthy();
  });
});
