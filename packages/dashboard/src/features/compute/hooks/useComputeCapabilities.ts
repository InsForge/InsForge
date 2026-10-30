import { useMetadata } from '#lib/hooks/useMetadata';
import type { ComputeCapabilitiesSchema } from '@insforge/shared-schemas';

/**
 * What a compute provider can actually do.
 *
 * The backend reports this as the `compute` slice of `/api/metadata`, keyed by
 * provider. Offering a control the provider will ignore is worse than not
 * offering it: a self-hoster on the Docker driver who picks a region gets a
 * container on their one host and no indication that the choice went nowhere.
 *
 * Pass a provider name to ask about a specific one. Providers coexist — the
 * backend routes per service row — so a deployment can hold Fly services and
 * Docker services at once, and a card must describe the provider that owns *that*
 * service rather than whichever one new services happen to go to. Omit the
 * argument to ask about the default provider, which is what a create form wants.
 *
 * `capabilities` is undefined in three situations — metadata still loading,
 * compute not enabled, or a backend older than the slice. Callers should treat
 * that as "not known yet"; see the call sites for which way each control falls
 * back, since the safe direction is not the same for all of them.
 */
export function useComputeCapabilities(provider?: string): {
  capabilities: ComputeCapabilitiesSchema | undefined;
  provider: string | undefined;
  isLoading: boolean;
} {
  const { metadata, isLoading } = useMetadata();
  const compute = metadata?.compute;
  const name = provider ?? compute?.defaultProvider;
  // A provider name off a service row is a plain string, and one the backend no
  // longer reports should simply read as unknown rather than fail to compile.
  const providers = compute?.providers as
    | Record<string, ComputeCapabilitiesSchema | undefined>
    | undefined;
  return {
    capabilities: name ? providers?.[name] : undefined,
    provider: name,
    isLoading,
  };
}
