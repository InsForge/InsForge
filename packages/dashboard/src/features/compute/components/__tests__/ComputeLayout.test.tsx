import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceSchema } from '@insforge/shared-schemas';

const meta = vi.hoisted(() => ({ value: undefined as unknown, isLoading: false }));
const listed = vi.hoisted(() => ({
  services: [] as ServiceSchema[],
  enabledCalls: [] as boolean[],
}));

vi.mock('#lib/hooks/useMetadata', () => ({
  useMetadata: () => ({ metadata: meta.value, isLoading: meta.isLoading }),
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

/** Renders the layout with a stub provider page in place of the real one. */
function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/dashboard/compute" element={<ComputeLayout />}>
          <Route path=":provider" element={<div data-testid="provider-page">page</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('ComputeLayout', () => {
  beforeEach(() => {
    listed.services = [];
    listed.enabledCalls = [];
    meta.isLoading = false;
    vi.clearAllMocks();
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
});
