import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PosthogKeyForm } from '#features/analytics/components/posthog/PosthogKeyForm';

const { listPosthogProjects, updatePosthogConfig } = vi.hoisted(() => ({
  listPosthogProjects: vi.fn(),
  updatePosthogConfig: vi.fn().mockResolvedValue({
    personalApiKey: { configured: true, maskedKey: 'phx_AaBb••••••••WxYz' },
  }),
}));
vi.mock('#features/analytics/services/analytics.service', () => ({
  analyticsService: { listPosthogProjects, updatePosthogConfig },
}));

// jsdom lacks the pointer-capture and scroll APIs Radix Select drives.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

const KEY = 'phx_AaBbCcDdEeFf';

function renderForm() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PosthogKeyForm />
    </QueryClientProvider>
  );
}

async function typeKey() {
  await userEvent.type(await screen.findByLabelText(/posthog personal api key/i), KEY);
}

function submit() {
  return userEvent.click(screen.getByRole('button', { name: /connect posthog/i }));
}

describe('PosthogKeyForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listPosthogProjects.mockResolvedValue([
      { posthogProjectId: '4242', name: 'Web', organizationName: 'Acme' },
    ]);
  });

  it('discovers before it writes, so a bad key never reaches storage', async () => {
    renderForm();
    await typeKey();
    await submit();

    await waitFor(() => expect(updatePosthogConfig).toHaveBeenCalled());
    expect(listPosthogProjects).toHaveBeenCalledWith(KEY, 'US');
    // Single project — connected without asking the user for an id.
    expect(updatePosthogConfig).toHaveBeenCalledWith({ personalApiKey: KEY, region: 'US' });
  });

  it('does not store anything when the key is rejected', async () => {
    listPosthogProjects.mockRejectedValue(new Error('PostHog rejected that personal API key.'));
    renderForm();
    await typeKey();
    await submit();

    expect(await screen.findByRole('alert')).toHaveTextContent(/rejected that personal api key/i);
    expect(updatePosthogConfig).not.toHaveBeenCalled();
  });

  it('asks which project to use instead of guessing when the key sees several', async () => {
    listPosthogProjects.mockResolvedValue([
      { posthogProjectId: '1', name: 'Web', organizationName: 'Acme' },
      { posthogProjectId: '2', name: 'Mobile', organizationName: 'Acme' },
    ]);
    renderForm();
    await typeKey();
    await submit();

    expect(await screen.findByLabelText(/posthog project/i)).toBeInTheDocument();
    // Nothing written yet, and nothing preselected — the submit beside the
    // picker stays disabled until the ambiguity is resolved explicitly.
    expect(updatePosthogConfig).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /connect posthog/i })).toBeDisabled();

    await userEvent.click(screen.getByLabelText(/posthog project/i));
    await userEvent.click(await screen.findByRole('option', { name: /mobile/i }));
    await submit();

    await waitFor(() =>
      expect(updatePosthogConfig).toHaveBeenCalledWith({
        personalApiKey: KEY,
        region: 'US',
        posthogProjectId: '2',
      })
    );
  });

  it('clears a stale picker when the key is edited', async () => {
    listPosthogProjects.mockResolvedValue([
      { posthogProjectId: '1', name: 'Web', organizationName: null },
      { posthogProjectId: '2', name: 'Mobile', organizationName: null },
    ]);
    renderForm();
    await typeKey();
    await submit();
    expect(await screen.findByLabelText(/posthog project/i)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/posthog personal api key/i), 'X');
    // The picker described the previous key's projects; keeping it on screen
    // would let the user connect an id the new key may not even see.
    await waitFor(() =>
      expect(screen.queryByLabelText(/posthog project/i)).not.toBeInTheDocument()
    );
  });

  it('does not submit an empty key', async () => {
    renderForm();
    expect(screen.getByRole('button', { name: /connect posthog/i })).toBeDisabled();
    expect(listPosthogProjects).not.toHaveBeenCalled();
  });

  it('never renders the key back to the page', async () => {
    renderForm();
    await typeKey();
    await submit();
    await waitFor(() => expect(updatePosthogConfig).toHaveBeenCalled());

    // The input is a password field and the form clears on success; the raw key
    // must not survive anywhere in the rendered output.
    expect(document.body.textContent).not.toContain(KEY);
  });
});
