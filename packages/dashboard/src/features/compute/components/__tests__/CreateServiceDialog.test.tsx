import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComputeCapabilitiesSchema } from '@insforge/shared-schemas';

// The dialog reads capabilities through this hook; driving it directly keeps the
// test about what the form offers rather than about react-query.
const caps = vi.hoisted(() => ({ value: undefined as ComputeCapabilitiesSchema | undefined }));
vi.mock('#features/compute/hooks/useComputeCapabilities', () => ({
  useComputeCapabilities: () => ({
    capabilities: caps.value,
    provider: caps.value ? 'test' : undefined,
    isLoading: false,
  }),
}));

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
    vi.clearAllMocks();
  });

  // A single-host driver has one place to run. Offering a region picker there
  // records a choice that goes nowhere, with nothing telling the user.
  it('hides Region and omits it from the payload when the provider has none', async () => {
    caps.value = DOCKER;
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(
      <CreateServiceDialog open onOpenChange={vi.fn()} onCreate={onCreate} isCreating={false} />
    );

    expect(screen.queryByText('Region')).toBeNull();
    const payload = await fillAndSubmit(onCreate);
    expect(payload).not.toHaveProperty('region');
  });

  // Ingress is only a choice where more than one mode exists, and without the
  // control every dashboard-created service on Docker would be unreachable.
  it('offers the provider’s ingress modes and sends the chosen one', async () => {
    caps.value = DOCKER;
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(
      <CreateServiceDialog open onOpenChange={vi.fn()} onCreate={onCreate} isCreating={false} />
    );

    expect(screen.getByText('Reachable from')).toBeTruthy();
    const payload = await fillAndSubmit(onCreate);
    expect(payload.ingress).toBe('none');
  });

  it('keeps Region and drops the ingress control for a single-mode provider', async () => {
    caps.value = FLY;
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(
      <CreateServiceDialog open onOpenChange={vi.fn()} onCreate={onCreate} isCreating={false} />
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
      <CreateServiceDialog open onOpenChange={vi.fn()} onCreate={onCreate} isCreating={false} />
    );

    expect(screen.getByText('Region')).toBeTruthy();
    const payload = await fillAndSubmit(onCreate);
    expect(payload.region).toBe('iad');
  });
});
