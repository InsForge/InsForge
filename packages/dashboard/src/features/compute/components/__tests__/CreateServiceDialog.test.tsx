import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComputeCapabilitiesSchema } from '@insforge/shared-schemas';

// The dialog reads capabilities through this hook; driving it directly keeps the
// test about what the form offers rather than about react-query.
const caps = vi.hoisted(() => ({
  value: undefined as ComputeCapabilitiesSchema | undefined,
  askedFor: [] as (string | undefined)[],
}));
vi.mock('#features/compute/hooks/useComputeCapabilities', () => ({
  useComputeCapabilities: (provider?: string) => {
    caps.askedFor.push(provider);
    return {
      capabilities: caps.value,
      provider: provider ?? (caps.value ? 'test' : undefined),
      isLoading: false,
    };
  },
}));

// Radix's Select uses pointer-capture and scroll APIs jsdom does not implement.
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const { CreateServiceDialog } = await import('#features/compute/components/CreateServiceDialog');

const DOCKER: ComputeCapabilitiesSchema = {
  scaleToZero: false,
  regions: false,
  ingressModes: ['none', 'port', 'host'],
  sourceBuild: 'context-upload',
  deployTokenIssuance: false,
};

const FLY: ComputeCapabilitiesSchema = {
  scaleToZero: true,
  regions: true,
  ingressModes: ['host'],
  sourceBuild: 'flyctl',
  deployTokenIssuance: false,
};

async function fillAndSubmit(onCreate: ReturnType<typeof vi.fn>) {
  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText('my-api'), 'worker');
  await user.type(screen.getByPlaceholderText('nginx:alpine'), 'nginx:alpine');
  await user.click(screen.getByRole('button', { name: 'Create Service' }));
  await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
  return onCreate.mock.calls[0][0] as Record<string, unknown>;
}

describe('CreateServiceDialog capability gating', () => {
  beforeEach(() => {
    caps.value = undefined;
    caps.askedFor = [];
    vi.clearAllMocks();
  });

  // Providers coexist, and provider is the dashboard's navigation axis. Creating from
  // Fly's page must ask Fly what it supports and tell the server to create there —
  // otherwise the service lands on the default provider and the page that opened the
  // dialog filters it straight out of its own list.
  it('creates on the provider whose page it was opened from', async () => {
    caps.value = FLY;
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(
      <CreateServiceDialog
        provider="fly"
        open
        onOpenChange={vi.fn()}
        onCreate={onCreate}
        isCreating={false}
      />
    );

    expect(caps.askedFor).toContain('fly');
    const payload = await fillAndSubmit(onCreate);
    expect(payload.provider).toBe('fly');
  });

  // The operator's stored default, not the first mode in the list. Preselecting
  // 'none' against a deployment configured for published ports showed one thing in
  // the form and stored another.
  it("preselects the provider's default ingress and sends it unchanged", async () => {
    caps.value = { ...DOCKER, defaultIngress: 'port' };
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(
      <CreateServiceDialog
        provider="test"
        open
        onOpenChange={vi.fn()}
        onCreate={onCreate}
        isCreating={false}
      />
    );

    expect(screen.getByText('Published host port')).toBeTruthy();
    const payload = await fillAndSubmit(onCreate);
    expect(payload.ingress).toBe('port');
  });

  // A backend older than the field reports no default; falling back to private-only
  // keeps the previous behaviour rather than guessing something exposed.
  it('falls back to private-only when the backend reports no default', async () => {
    caps.value = DOCKER;
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(
      <CreateServiceDialog
        provider="test"
        open
        onOpenChange={vi.fn()}
        onCreate={onCreate}
        isCreating={false}
      />
    );

    const payload = await fillAndSubmit(onCreate);
    expect(payload.ingress).toBe('none');
  });

  // A single-host driver has one place to run. Offering a region picker there
  // records a choice that goes nowhere, with nothing telling the user.
  it('hides Region and omits it from the payload when the provider has none', async () => {
    caps.value = DOCKER;
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(
      <CreateServiceDialog
        provider="test"
        open
        onOpenChange={vi.fn()}
        onCreate={onCreate}
        isCreating={false}
      />
    );

    expect(screen.queryByText('Region')).toBeNull();
    const payload = await fillAndSubmit(onCreate);
    expect(payload).not.toHaveProperty('region');
  });

  // Ingress is only a choice where more than one mode exists, and without the
  // control every dashboard-created service on Docker would be unreachable.
  it('offers exactly the provider’s ingress modes and sends the chosen one', async () => {
    caps.value = { ...DOCKER, ingressModes: ['none', 'port'] };
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(
      <CreateServiceDialog
        provider="test"
        open
        onOpenChange={vi.fn()}
        onCreate={onCreate}
        isCreating={false}
      />
    );

    expect(screen.getByText('Reachable from')).toBeTruthy();

    // Open the select and check the options are filtered to what the provider
    // reported — offering `host` here would be the bug this gating prevents.
    const trigger = screen
      .getAllByRole('combobox')
      .find((el) => el.textContent?.includes('Private'));
    await user.click(trigger!);
    expect(screen.getByRole('option', { name: 'Published host port' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Hostname/ })).toBeNull();

    // And the choice actually reaches the payload, rather than the default.
    await user.click(screen.getByRole('option', { name: 'Published host port' }));
    await user.type(screen.getByPlaceholderText('my-api'), 'worker');
    await user.type(screen.getByPlaceholderText('nginx:alpine'), 'nginx:alpine');
    await user.click(screen.getByRole('button', { name: 'Create Service' }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
    expect((onCreate.mock.calls[0][0] as Record<string, unknown>).ingress).toBe('port');
  });

  it('keeps Region and drops the ingress control for a single-mode provider', async () => {
    caps.value = FLY;
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(
      <CreateServiceDialog
        provider="test"
        open
        onOpenChange={vi.fn()}
        onCreate={onCreate}
        isCreating={false}
      />
    );

    expect(screen.getByText('Region')).toBeTruthy();
    expect(screen.queryByText('Reachable from')).toBeNull();
    const payload = await fillAndSubmit(onCreate);
    expect(payload.region).toBe('iad');
    expect(payload).not.toHaveProperty('ingress');
  });

  // Unknown capabilities covers three cases at once: metadata still loading,
  // compute not configured, and a backend older than the slice. Showing
  // everything is the pre-capability behaviour and stays right for an old backend.
  it('shows Region when capabilities are unknown', async () => {
    caps.value = undefined;
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(
      <CreateServiceDialog
        provider="test"
        open
        onOpenChange={vi.fn()}
        onCreate={onCreate}
        isCreating={false}
      />
    );

    expect(screen.getByText('Region')).toBeTruthy();
    const payload = await fillAndSubmit(onCreate);
    expect(payload.region).toBe('iad');
  });
});
