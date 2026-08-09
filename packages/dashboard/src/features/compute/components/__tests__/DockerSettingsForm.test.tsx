import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@insforge/ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComputeConfig } from '@insforge/shared-schemas';

const api = vi.hoisted(() => ({
  config: {
    flyApiToken: { configured: false, masked: null, source: null },
    flyOrg: { configured: false, masked: null, source: null },
    settings: {
      defaultIngress: 'none',
      publicHost: '',
      domain: '',
      socketPath: '/var/run/docker.sock',
    },
  } as ComputeConfig,
  updateConfig: vi.fn(),
}));

vi.mock('#features/compute/services/compute.service', () => ({
  computeServicesApi: {
    getConfig: () => Promise.resolve(api.config),
    updateConfig: (input: unknown) => {
      api.updateConfig(input);
      return Promise.resolve(api.config);
    },
  },
}));

const { DockerSettingsForm } = await import('#features/compute/components/DockerSettingsForm');

function renderForm() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <DockerSettingsForm />
      </ToastProvider>
    </QueryClientProvider>
  );
}

describe('DockerSettingsForm', () => {
  beforeEach(() => {
    api.config = {
      flyApiToken: { configured: false, masked: null, source: null },
      flyOrg: { configured: false, masked: null, source: null },
      settings: {
        defaultIngress: 'none',
        publicHost: '',
        domain: '',
        socketPath: '/var/run/docker.sock',
      },
    } as ComputeConfig;
    vi.clearAllMocks();
  });

  // Seeded from what is in force, so an edit is a change to the current value rather
  // than a blank slate that would clear whatever is set.
  it('shows the values currently in force', async () => {
    api.config = {
      ...api.config,
      settings: {
        defaultIngress: 'port',
        publicHost: 'box.example',
        domain: 'apps.example.com',
        socketPath: '/run/user/1000/docker.sock',
      },
    };
    renderForm();

    await waitFor(() =>
      expect((screen.getByPlaceholderText('localhost') as HTMLInputElement).value).toBe(
        'box.example'
      )
    );
    expect((screen.getByPlaceholderText('apps.example.com') as HTMLInputElement).value).toBe(
      'apps.example.com'
    );
    expect((screen.getByPlaceholderText('/var/run/docker.sock') as HTMLInputElement).value).toBe(
      '/run/user/1000/docker.sock'
    );
  });

  // An empty public host means "advertise no URL" — a real setting. It has to be sent
  // as an empty string, because null would clear it back to the environment variable.
  it('sends an empty host as a value, not as a clear', async () => {
    const user = userEvent.setup();
    api.config = { ...api.config, settings: { ...api.config.settings, publicHost: 'box.example' } };
    renderForm();

    const host = await waitFor(() => screen.getByPlaceholderText('localhost') as HTMLInputElement);
    await user.clear(host);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.updateConfig).toHaveBeenCalledOnce());
    expect(api.updateConfig.mock.calls[0][0]).toMatchObject({ publicHost: '' });
  });

  // The socket is the one field where blank genuinely means "use the environment":
  // there is no such thing as "no socket", so an empty box clears the override.
  it('clears the socket path back to the environment when blanked', async () => {
    const user = userEvent.setup();
    renderForm();

    const socket = await waitFor(
      () => screen.getByPlaceholderText('/var/run/docker.sock') as HTMLInputElement
    );
    await user.clear(socket);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.updateConfig).toHaveBeenCalledOnce());
    expect(api.updateConfig.mock.calls[0][0]).toMatchObject({ socketPath: null });
  });

  // Bind address decides whether a container port is reachable from the internet, so
  // it stays behind host access rather than a dashboard session.
  it('does not offer the bind address', async () => {
    renderForm();
    await waitFor(() => expect(screen.getByPlaceholderText('localhost')).toBeTruthy());

    expect(screen.queryByText(/bind address/i)).toBeNull();
    expect(screen.queryByPlaceholderText('127.0.0.1')).toBeNull();
  });
});
