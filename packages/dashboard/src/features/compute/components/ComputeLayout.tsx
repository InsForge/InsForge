import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { ErrorState, LoadingState } from '#components';
import { useIsCloudHostingMode } from '#lib/config/DashboardHostContext';
import { useMetadata } from '#lib/hooks/useMetadata';
import { COMPUTE_PROVIDERS, isComputeProviderSlug } from '#features/compute/constants';
import { useComputeServices } from '#features/compute/hooks/useComputeServices';
import { ComputeSidebar } from './ComputeSidebar';
import { ComputeSettingsDialog } from './ComputeSettingsDialog';

/** The only compute page a cloud project has. */
const CLOUD_PATH = '/dashboard/compute/fly';

export interface ComputeOutletContext {
  /** Every service, unfiltered; the provider page narrows to its own. */
  services: ReturnType<typeof useComputeServices>['services'];
  /** Providers the backend reports as configured. */
  configured: string[];
  defaultProvider: string | undefined;
  /**
   * Opens the compute settings dialog, which the layout owns. Absent on cloud, where
   * there is no dialog: the socket is not mountable and the Fly credentials belong to
   * InsForge, not the project.
   */
  openSettings?: (provider?: string) => void;
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
 *
 * Cloud-managed projects get none of that. Docker is self-host only — the backend
 * refuses to register it when either cloud signal is present, because there the
 * operator and the developer are different principals and a container on the host
 * would be a tenant escape. With one provider there is nothing to switch between, so
 * the sidebar and its settings gear are dropped and Fly's page is the whole tab.
 */
export default function ComputeLayout() {
  const { t } = useTranslation('chrome');
  const { pathname } = useLocation();
  const isCloud = useIsCloudHostingMode();
  // Last path segment when it names a provider we have a page for.
  const viewedProvider = COMPUTE_PROVIDERS.map((p) => p.slug).find(
    // Trailing slash tolerated: `/dashboard/compute/fly/` is the same page, and an
    // exact match sent the gear back to Docker there.
    (slug) => pathname.replace(/\/+$/, '') === `/dashboard/compute/${slug}`
  );
  const {
    metadata,
    isLoading: metadataLoading,
    error: metadataError,
    refetch: refetchMetadata,
  } = useMetadata();
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
    return (
      <div className="flex h-full min-h-0 items-center justify-center">
        <LoadingState
          className="py-0"
          message={t('compute.loadingCompute', { defaultValue: 'Loading Compute…' })}
        />
      </div>
    );
  }

  // A failed metadata request is not "compute is off": without this the whole tab
  // shows a setup guide during a backend outage, telling an operator to mount a socket
  // they have already mounted, with nothing to retry.
  if (metadataError) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-6">
        <div className="w-full max-w-[420px]">
          <ErrorState error={metadataError as Error} onRetry={() => void refetchMetadata()} />
        </div>
      </div>
    );
  }

  // One provider, so there is nowhere else to be — including a bookmark of the Docker
  // page, which on cloud would otherwise offer setup steps for something the backend
  // will not register.
  if (isCloud) {
    if (pathname !== CLOUD_PATH) {
      return <Navigate to={CLOUD_PATH} replace />;
    }
    return (
      <div className="flex h-full min-h-0 overflow-hidden bg-[rgb(var(--semantic-1))]">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <Outlet
            context={
              {
                services,
                configured,
                defaultProvider: compute?.defaultProvider,
              } satisfies ComputeOutletContext
            }
          />
        </div>
      </div>
    );
  }

  // Land on something useful: the provider new services go to, else the first one
  // configured, else Docker — the option a self-hoster can act on without an account.
  if (pathname === '/dashboard/compute' || pathname === '/dashboard/compute/') {
    // Both candidates are checked against the slugs this dashboard has pages for. An
    // unrecognised one would redirect here, get bounced back by the page's own slug
    // guard, and loop.
    const known = configured.filter(isComputeProviderSlug);
    const landing =
      (compute?.defaultProvider && isComputeProviderSlug(compute.defaultProvider)
        ? compute.defaultProvider
        : known[0]) ?? 'docker';
    return <Navigate to={`/dashboard/compute/${landing}`} replace />;
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-[rgb(var(--semantic-1))]">
      {/* The provider being looked at, so the gear opens that tab rather than always
          landing on Docker. */}
      <ComputeSidebar onOpenSettings={() => openSettings(viewedProvider)} />
      {/* flex-col, not a plain block: the pages inside size themselves with
          `flex-1 min-h-0`, which needs a flex parent to resolve against. As a block
          this grew to content height and the `overflow-hidden` here clipped the
          overflow with nothing able to scroll it. Same wrapper WebscraperLayout uses. */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
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
