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
  } as ComputeConfig,
  updateConfig: vi.fn(),
}));

vi.mock('#features/compute/services/compute.service', () => ({
  computeServicesApi: {
    getConfig: () => Promise.resolve(api.config),
    // Returns whatever the spy returns so a test can reject: previously it recorded the
    // call and resolved regardless, which made a failure path impossible to exercise.
    updateConfig: (input: unknown) =>
      (api.updateConfig(input) as Promise<unknown> | undefined) ?? Promise.resolve(api.config),
  },
}));

const { FlyCredentialsForm } = await import('#features/compute/components/FlyCredentialsForm');

function renderForm() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <FlyCredentialsForm />
      </ToastProvider>
    </QueryClientProvider>
  );
}

describe('FlyCredentialsForm', () => {
  beforeEach(() => {
    api.config = {
      flyApiToken: { configured: false, masked: null, source: null },
      flyOrg: { configured: false, masked: null, source: null },
    };
    vi.clearAllMocks();
  });

  it('sends only the fields that were filled in', async () => {
    const user = userEvent.setup();
    renderForm();
    await waitFor(() => expect(screen.getByLabelText('API token')).toBeTruthy());

    await user.type(screen.getByLabelText('API token'), 'fo1_token');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.updateConfig).toHaveBeenCalledOnce());
    // The org was left blank, so it must not be sent — an empty string would
    // overwrite a stored org with nothing.
    expect(api.updateConfig).toHaveBeenCalledWith({ flyApiToken: 'fo1_token' });
  });

  // Nothing typed means nothing to save; enabling the button would invite a request
  // that either clears credentials or 400s on the refine.
  it('cannot save until something is entered', async () => {
    renderForm();
    await waitFor(() => expect(screen.getByLabelText('API token')).toBeTruthy());

    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });

  // The token is never returned, so the masked hint is the only way to tell which one
  // is stored. It belongs in the placeholder, not the value.
  it('shows the stored token as a masked placeholder, never as a value', async () => {
    api.config = {
      flyApiToken: { configured: true, masked: 'fo1_••••••cdef', source: 'stored' },
      flyOrg: { configured: true, masked: 'my-org', source: 'environment' },
    };
    renderForm();

    const token = await waitFor(() => screen.getByLabelText('API token') as HTMLInputElement);
    expect(token.placeholder).toBe('fo1_••••••cdef');
    expect(token.value).toBe('');
    // An env-provided value is flagged, since saving here overrides it.
    expect(screen.getByText('From environment')).toBeTruthy();
  });

  it('keeps the token masked until the reveal is pressed', async () => {
    const user = userEvent.setup();
    renderForm();
    const token = await waitFor(() => screen.getByLabelText('API token') as HTMLInputElement);

    expect(token.type).toBe('password');
    await user.click(screen.getByRole('button', { name: 'Show token' }));
    expect((screen.getByLabelText('API token') as HTMLInputElement).type).toBe('text');
  });

  // The catch exists so a failed save does not wipe a pasted token. Without a test,
  // clearing the fields again would look like a harmless simplification.
  it('keeps what was typed when the save fails', async () => {
    const user = userEvent.setup();
    api.updateConfig.mockRejectedValueOnce(new Error('Fly rejected the token'));
    renderForm();

    const token = await waitFor(
      () => screen.getByPlaceholderText('Paste a Fly API token') as HTMLInputElement
    );
    await user.type(token, 'FlyV1 fm2_typed');
    await user.type(screen.getByPlaceholderText('your-org-slug'), 'my-org');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.updateConfig).toHaveBeenCalledOnce());
    expect((screen.getByPlaceholderText('Paste a Fly API token') as HTMLInputElement).value).toBe(
      'FlyV1 fm2_typed'
    );
    expect((screen.getByPlaceholderText('your-org-slug') as HTMLInputElement).value).toBe('my-org');
  });
});
