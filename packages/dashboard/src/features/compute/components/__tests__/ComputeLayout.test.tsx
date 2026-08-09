import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceSchema } from '@insforge/shared-schemas';

const meta = vi.hoisted(() => ({
  value: undefined as unknown,
  isLoading: false,
}));
const listed = vi.hoisted(() => ({
  services: [] as ServiceSchema[],
  enabledCalls: [] as boolean[],
}));

const stored = vi.hoisted(() => ({ filter: null as unknown }));
vi.mock('#lib/utils/local-storage', () => ({
  getLocalStorageJSON: () => stored.filter,
  setLocalStorageJSON: (_key: string, value: unknown) => {
    stored.filter = value;
    return true;
  },
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

/** Renders the layout with a child that reports what the outlet handed it. */
function renderLayout(initialPath = '/dashboard/compute/services') {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/dashboard/compute" element={<ComputeLayout />}>
          <Route path="services" element={<div data-testid="child">rendered</div>} />
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
    stored.filter = null;
    vi.clearAllMocks();
  });

  // The bug this replaces: a spinner followed by a 503 body, which reads as a
  // broken page rather than a feature nobody turned on.
  it('shows the setup state and skips the list request when compute is off', () => {
    meta.value = { version: '1' }; // metadata present, no compute slice
    renderLayout();

    // Quick start in the content area, not a full-page takeover: the tab keeps its
    // shape so it reads as unconfigured rather than broken.
    expect(screen.getByText(/Compute is not enabled yet/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Set up compute/i })).toBeTruthy();
    // Both providers named, Docker first — a self-hoster needs to discover the
    // socket option, which the old Fly-only copy never mentioned.
    expect(screen.getByText(/Your own Docker host/i)).toBeTruthy();
    // The secondary nav stays visible, with its entries disabled.
    expect(screen.getByText('Services')).toBeTruthy();
    expect(screen.getByText(/No provider configured yet/i)).toBeTruthy();
    expect(listed.enabledCalls.every((e) => e === false)).toBe(true);
    expect(screen.queryByTestId('child')).toBeNull();
  });

  // One provider is the common case; a one-item dropdown is a control that does
  // nothing, the same mistake as a region picker on a single-host driver.
  it('hides the provider filter when only one provider is configured', () => {
    meta.value = { compute: { defaultProvider: 'docker', providers: { docker: {} } } };
    renderLayout();

    expect(screen.queryByLabelText(/Filter services by provider/i)).toBeNull();
    expect(screen.getByTestId('child')).toBeTruthy();
  });

  it('offers the filter and narrows the list when providers coexist', () => {
    meta.value = {
      compute: { defaultProvider: 'fly', providers: { fly: {}, docker: {} } },
    };
    listed.services = [
      service({ id: 'a', provider: 'docker' }),
      service({ id: 'b', provider: 'fly' }),
      service({ id: 'c', provider: 'fly' }),
    ];
    stored.filter = 'fly';
    renderLayout();

    expect(screen.getByLabelText(/Filter services by provider/i)).toBeTruthy();
    // The nav label carries the visible count, so filtering to fly shows 2 of 3.
    expect(screen.getByText('Services (2)')).toBeTruthy();
  });

  // A stored filter naming a provider that is no longer configured would silently
  // hide every service.
  it('falls back to all providers when the stored filter is stale', () => {
    meta.value = { compute: { defaultProvider: 'docker', providers: { docker: {} } } };
    listed.services = [service({ id: 'a', provider: 'docker' })];
    stored.filter = 'fly';
    renderLayout();

    expect(screen.getByText('Services (1)')).toBeTruthy();
  });
});
