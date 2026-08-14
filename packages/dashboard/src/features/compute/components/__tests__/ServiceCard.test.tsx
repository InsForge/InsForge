import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComputeCapabilitiesSchema, ServiceSchema } from '@insforge/shared-schemas';

// Capabilities are looked up per provider, so the mock records which provider it was
// asked about — that is the whole behaviour under test.
const asked = vi.hoisted(() => ({ providers: [] as (string | undefined)[] }));
const caps = vi.hoisted(() => ({
  byProvider: {} as Record<string, ComputeCapabilitiesSchema | undefined>,
  fallback: undefined as ComputeCapabilitiesSchema | undefined,
}));

vi.mock('#features/compute/hooks/useComputeCapabilities', () => ({
  useComputeCapabilities: (provider?: string) => {
    asked.providers.push(provider);
    return {
      capabilities: provider ? caps.byProvider[provider] : caps.fallback,
      provider,
      isLoading: false,
    };
  },
}));

vi.mock('#features/compute/hooks/useComputeServices', () => ({
  useServiceHealth: () => ({ health: undefined }),
}));

const { ServiceCard } = await import('#features/compute/components/ServiceCard');

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

function service(overrides: Partial<ServiceSchema> = {}): ServiceSchema {
  return {
    id: 'svc-1',
    projectId: 'proj-1',
    name: 'worker',
    imageUrl: 'nginx:alpine',
    port: 8080,
    cpu: 'shared-1x',
    cpus: 1,
    memory: 512,
    region: 'local',
    protocol: 'http',
    scaleToZero: false,
    ingress: 'port',
    provider: 'docker',
    providerAppId: 'insforge-k-worker',
    providerInstanceId: 'abc123',
    flyAppId: 'insforge-k-worker',
    flyMachineId: 'abc123',
    status: 'running',
    endpointUrl: null,
    createdAt: '2026-08-08T00:00:00.000Z',
    updatedAt: '2026-08-08T00:00:00.000Z',
    ...overrides,
  } as ServiceSchema;
}

function renderCard(s: ServiceSchema) {
  render(
    <ServiceCard
      service={s}
      onClick={vi.fn()}
      onStop={vi.fn()}
      onStart={vi.fn()}
      onDelete={vi.fn()}
    />
  );
}

describe('ServiceCard provider-aware footer', () => {
  beforeEach(() => {
    asked.providers = [];
    caps.byProvider = { docker: DOCKER, fly: FLY };
    caps.fallback = undefined;
    vi.clearAllMocks();
  });

  // The bug this guards: with both providers in one deployment, using the
  // deployment default would label every card by the wrong provider.
  it('asks about the service’s own provider, not the default', () => {
    renderCard(service({ provider: 'fly', region: 'lhr' }));
    expect(asked.providers).toContain('fly');
  });

  it('shows ingress instead of region for a single-host provider', () => {
    renderCard(service({ provider: 'docker', region: 'local', ingress: 'port' }));

    // A friendly label, not the raw enum, and not the meaningless `local`.
    expect(screen.getByText('Published host port')).toBeTruthy();
    expect(screen.queryByText('local')).toBeNull();
  });

  // A Fly service in the same deployment keeps the region it genuinely has, even
  // when the deployment's default provider is Docker.
  it('keeps region for a region-capable provider', () => {
    renderCard(service({ provider: 'fly', region: 'lhr', ingress: 'host' }));

    expect(screen.getByText('lhr')).toBeTruthy();
    expect(screen.queryByText('Hostname (routed by your gateway)')).toBeNull();
  });

  it('falls back to showing region when the provider is unknown', () => {
    caps.byProvider = {};
    renderCard(service({ provider: 'docker', region: 'local' }));

    expect(screen.getByText('local')).toBeTruthy();
  });
});
