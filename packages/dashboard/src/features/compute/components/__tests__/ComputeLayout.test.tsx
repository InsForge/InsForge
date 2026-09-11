import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@insforge/ui';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceSchema } from '@insforge/shared-schemas';

const meta = vi.hoisted(() => ({
  value: undefined as unknown,
  isLoading: false,
  error: undefined as Error | undefined,
}));
const host = vi.hoisted(() => ({ isCloud: false }));
const listed = vi.hoisted(() => ({
  services: [] as ServiceSchema[],
  enabledCalls: [] as boolean[],
}));

vi.mock('#lib/hooks/useMetadata', () => ({
  useMetadata: () => ({
    metadata: meta.value,
    isLoading: meta.isLoading,
    error: meta.error,
    refetch: vi.fn(),
  }),
}));

vi.mock('#lib/config/DashboardHostContext', () => ({
  useIsCloudHostingMode: () => host.isCloud,
}));

// Records the `enabled` flag so the fail-fast gate is observable: an unconfigured
// deployment must not fire a list request that can only 503.
vi.mock('#features/compute/hooks/useComputeServices', () => ({
  useComputeServices: (enabled = true) => {
    listed.enabledCalls.push(enabled);
    return { services: enabled ? listed.services : [] };
  },
  useServiceHealth: () => ({ health: undefined }),
}));

const ComputeLayout = (await import('#features/compute/components/ComputeLayout')).default;

function service(overrides: Partial<ServiceSchema>): ServiceSchema {
  return {
    id: 'svc',
    name: 'svc',
    provider: 'docker',
    region: 'local',
    ingress: 'none',
    status: 'running',
    ...overrides,
  } as ServiceSchema;
}

/**
 * Stub provider page that reports which slug it was mounted for, so a test can tell a
 * redirect from a render — asserting only that "a page appeared" passes even when the
 * layout sent the reader to the wrong provider.
 */
function ProviderStub() {
  const { provider } = useParams();
  return <div data-testid="provider-page">{provider}</div>;
}

/** Renders the layout with a stub provider page in place of the real one. */
function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/dashboard/compute" element={<ComputeLayout />}>
          <Route path=":provider" element={<ProviderStub />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('ComputeLayout', () => {
  beforeEach(() => {
    listed.services = [];
    listed.enabledCalls = [];
    meta.value = undefined;
    meta.isLoading = false;
    meta.error = undefined;
    host.isCloud = false;
    vi.clearAllMocks();
  });

  // Every other feature layout centres its spinner in the pane and names what is
  // loading (WebscraperLayout, AnalyticsLayout). Compute rendered a bare LoadingState,
  // which sits at the top of the pane and says "Loading...", so switching tabs looked
  // like a different app for a moment.
  it('centres the spinner and names the feature, like the other layouts', () => {
    meta.isLoading = true;
    renderAt('/dashboard/compute/docker');

    const message = screen.getByText('Loading Compute…');
    // LoadingState's own padding is dropped in favour of the wrapper's centring —
    // py-12 plus items-center is what made it sit high in the pane.
    const spinnerBox = message.parentElement;
    expect(spinnerBox?.className).toContain('py-0');
    expect(spinnerBox?.parentElement?.className).toContain('items-center');
    expect(spinnerBox?.parentElement?.className).toContain('justify-center');
    expect(spinnerBox?.parentElement?.className).toContain('h-full');
  });

  // Provider is the navigation axis, so both are always offered. A self-hoster who
  // cannot see Docker in the nav has no way to discover that it exists, which is the
  // confusion this replaced.
  it('lists both providers even when neither is configured', () => {
    meta.value = { version: '1' };
    renderAt('/dashboard/compute/docker');

    expect(screen.getByText('Docker')).toBeTruthy();
    expect(screen.getByText('Fly.io')).toBeTruthy();
    // No status text or divider in the sidebar — the content pane owns that state,
    // the way WebscraperLayout does for an unconnected account.
    expect(screen.queryByText(/No provider configured yet/i)).toBeNull();
  });

  it('skips the list request when compute is off', () => {
    meta.value = { version: '1' };
    renderAt('/dashboard/compute/docker');

    expect(listed.enabledCalls.length).toBeGreaterThan(0);
    expect(listed.enabledCalls.every((e) => e === false)).toBe(true);
  });

  // The bare path has to land on a provider rather than render an empty shell.
  it('redirects the bare path to a provider route', () => {
    meta.value = { compute: { defaultProvider: 'fly', providers: { fly: {}, docker: {} } } };
    renderAt('/dashboard/compute');

    expect(screen.getByTestId('provider-page')).toBeTruthy();
  });

  // With nothing configured there is no default, and Docker is the option an operator
  // can act on without signing up for anything.
  it('still lands on a provider when there is no default', () => {
    meta.value = { version: '1' };
    renderAt('/dashboard/compute');

    expect(screen.getByTestId('provider-page')).toBeTruthy();
  });

  it('fetches the list once compute is configured', () => {
    meta.value = { compute: { defaultProvider: 'docker', providers: { docker: {} } } };
    listed.services = [service({ id: 'a' }), service({ id: 'b', provider: 'fly' })];
    renderAt('/dashboard/compute/docker');

    expect(screen.getByTestId('provider-page')).toBeTruthy();
    expect(listed.enabledCalls.some((e) => e === true)).toBe(true);
  });

  // The gear lives in the sidebar, which does not know the route. A trailing slash is
  // the same page, and an exact pathname match sent the dialog back to Docker there.
  it('opens settings on the provider being viewed, trailing slash or not', async () => {
    meta.value = {
      compute: { defaultProvider: 'docker', providers: { docker: {}, fly: {} } },
    };
    const { default: Layout } = await import('#features/compute/components/ComputeLayout');
    for (const path of ['/dashboard/compute/fly', '/dashboard/compute/fly/']) {
      // Providers only for this case: opening the dialog mounts the Fly credential
      // form, which reads react-query and reports failures through the toast context.
      const { unmount } = render(
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <ToastProvider>
            <MemoryRouter initialEntries={[path]}>
              <Routes>
                <Route path="/dashboard/compute" element={<Layout />}>
                  <Route path=":provider" element={<ProviderStub />} />
                </Route>
              </Routes>
            </MemoryRouter>
          </ToastProvider>
        </QueryClientProvider>
      );
      await userEvent.click(screen.getByRole('button', { name: /compute settings/i }));
      // The *heading* of the main pane, not the dialog's text: the side nav lists both
      // providers, so matching anywhere in the dialog passes even when the wrong tab is
      // open. Radix renders DialogTitle as a heading; the nav entries are buttons.
      expect(
        within(screen.getByRole('dialog')).getByRole('heading', { name: 'Fly.io' })
      ).toBeTruthy();
      unmount();
    }
  });

  // Metadata failing is an outage, not a missing socket. Showing the setup guide there
  // tells an operator to do something they have already done, with nothing to retry.
  it('shows a retryable error when metadata fails, not a setup guide', () => {
    meta.error = new Error('Network request failed');
    renderAt('/dashboard/compute/docker');

    expect(screen.getByText(/Network request failed/i)).toBeTruthy();
    expect(screen.queryByTestId('provider-page')).toBeNull();
  });

  // Docker is self-host only: the backend refuses to register it when either cloud
  // signal is present, so on cloud there is one provider and nothing to switch
  // between. A sidebar whose only job is switching would be furniture.
  describe('cloud-managed projects', () => {
    beforeEach(() => {
      host.isCloud = true;
      meta.value = {
        compute: { defaultProvider: 'fly', providers: { fly: { ingressModes: ['host'] } } },
      };
    });

    it('shows Fly’s page with no provider sidebar', () => {
      renderAt('/dashboard/compute/fly');

      expect(screen.getByTestId('provider-page')).toBeTruthy();
      expect(screen.queryByText('Docker')).toBeNull();
      expect(screen.queryByRole('button', { name: /settings/i })).toBeNull();
    });

    it('sends the bare path to Fly', () => {
      renderAt('/dashboard/compute');

      expect(screen.getByTestId('provider-page').textContent).toBe('fly');
    });

    // A bookmark from a self-hosted project would otherwise land on a page offering
    // socket-mount steps for a provider this backend will not register.
    it('redirects a Docker bookmark to Fly', () => {
      renderAt('/dashboard/compute/docker');

      expect(screen.getByTestId('provider-page').textContent).toBe('fly');
    });
  });
});
