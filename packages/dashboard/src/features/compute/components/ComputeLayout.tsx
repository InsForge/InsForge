import { useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { LoadingState } from '#components';
import { useMetadata } from '#lib/hooks/useMetadata';
import { COMPUTE_PROVIDERS } from '#features/compute/constants';
import { useComputeServices } from '#features/compute/hooks/useComputeServices';
import { ComputeSidebar } from './ComputeSidebar';
import { ComputeSettingsDialog } from './ComputeSettingsDialog';

export interface ComputeOutletContext {
  /** Every service, unfiltered; the provider page narrows to its own. */
  services: ReturnType<typeof useComputeServices>['services'];
  /** Providers the backend reports as configured. */
  configured: string[];
  defaultProvider: string | undefined;
  /** Opens the compute settings dialog, which the layout owns. */
  openSettings: (provider?: string) => void;
}

/**
 * Shell for the compute tab: one sidebar entry per provider, that provider's
 * services in the main area.
 *
 * Provider is the navigation axis rather than a filter control. Compute is
 * configured through environment variables, so picking one chooses what to look at,
 * not where new services go — the backend decides that and reports it as the default.
 *
 * The service list is fetched once here and narrowed per page, because the API
 * returns every provider's services in a single call.
 */
export default function ComputeLayout() {
  const { pathname } = useLocation();
  const { metadata, isLoading: metadataLoading } = useMetadata();
  const compute = metadata?.compute;
  const configured = compute ? Object.keys(compute.providers ?? {}) : [];

  const [settingsProvider, setSettingsProvider] = useState<string | undefined>(undefined);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const openSettings = (provider?: string) => {
    setSettingsProvider(provider);
    setIsSettingsOpen(true);
  };

  // Gate the list request on metadata: it would only 503 when nothing is configured,
  // and spinning on a call whose failure is already known reads as a broken page.
  const isConfigured = metadata ? compute !== undefined : undefined;
  const { services } = useComputeServices(isConfigured === true);

  if (metadataLoading) {
    return <LoadingState />;
  }

  // Land on something useful: the provider new services go to, else the first one
  // configured, else Docker — the option a self-hoster can act on without an account.
  if (pathname === '/dashboard/compute' || pathname === '/dashboard/compute/') {
    const landing =
      (compute?.defaultProvider && COMPUTE_PROVIDERS.some((p) => p.slug === compute.defaultProvider)
        ? compute.defaultProvider
        : configured[0]) ?? 'docker';
    return <Navigate to={`/dashboard/compute/${landing}`} replace />;
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-[rgb(var(--semantic-1))]">
      <ComputeSidebar onOpenSettings={() => openSettings()} />
      <div className="min-w-0 flex-1 overflow-hidden">
        <Outlet
          context={
            {
              services,
              configured,
              defaultProvider: compute?.defaultProvider,
              openSettings,
            } satisfies ComputeOutletContext
          }
        />
      </div>
      <ComputeSettingsDialog
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        configured={configured}
        defaultProvider={compute?.defaultProvider}
        initialProvider={settingsProvider}
        capabilities={compute?.providers}
      />
    </div>
  );
}
