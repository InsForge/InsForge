import { useMetadata } from '#lib/hooks/useMetadata';
import type { ComputeCapabilitiesSchema } from '@insforge/shared-schemas';

/**
 * What the configured compute provider can actually do.
 *
 * The backend reports this as the `compute` slice of `/api/metadata`, keyed by
 * provider. Offering a control the provider will ignore is worse than not
 * offering it: a self-hoster on the Docker driver who picks a region gets a
 * container on their one host and no indication that the choice went nowhere.
 *
 * The slice is absent when no driver is configured, so `capabilities` is
 * undefined in three different situations — metadata still loading, compute not
 * enabled, or an older backend that predates the slice. Callers should treat
 * undefined as "don't know yet" and fall back to showing everything, which is
 * the pre-capability behaviour and stays correct against an older backend.
 */
export function useComputeCapabilities(): {
  capabilities: ComputeCapabilitiesSchema | undefined;
  provider: string | undefined;
  isLoading: boolean;
} {
  const { metadata, isLoading } = useMetadata();
  const compute = metadata?.compute;
  const provider = compute?.defaultProvider;
  return {
    capabilities: provider ? compute?.providers?.[provider] : undefined,
    provider,
    isLoading,
  };
}
