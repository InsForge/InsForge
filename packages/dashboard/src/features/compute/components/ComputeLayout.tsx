import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { LoadingState } from '#components';
import { useMetadata } from '#lib/hooks/useMetadata';
import { getLocalStorageJSON, setLocalStorageJSON } from '#lib/utils/local-storage';
import { ALL_PROVIDERS, type ProviderFilter } from '#features/compute/constants';
import { ComputeSidebar } from './ComputeSidebar';
import { ComputeQuickStart } from './ComputeQuickStart';
import { ComputeSettingsDialog } from './ComputeSettingsDialog';
import { useComputeServices } from '#features/compute/hooks/useComputeServices';

const COMPUTE_FILTER_STORAGE_KEY = 'insforge.compute.providerFilter';

export interface ComputeOutletContext {
  /** Services already narrowed to the selected provider. */
  services: ReturnType<typeof useComputeServices>['services'];
  /** Providers the backend reports as configured. */
  configured: string[];
  defaultProvider: string | undefined;
  filter: ProviderFilter;
  /** Opens the compute settings dialog, which the layout owns. */
  openSettings: () => void;
}

/**
 * Shell for the compute tab: secondary nav plus the selected sub-page.
 *
 * The not-configured state lives here rather than in each sub-page. It is decided
 * from metadata, which is cached across the dashboard, so an unconfigured
 * deployment never fires a service list request that can only 503 — a spinner
 * followed by an error reads as a broken page rather than a feature nobody turned
 * on.
 */
export default function ComputeLayout() {
  const { metadata, isLoading: metadataLoading } = useMetadata();
  const compute = metadata?.compute;
  const configured = compute ? Object.keys(compute.providers ?? {}) : [];
  const isConfigured = metadata ? compute !== undefined : undefined;

  const [filter, setFilter] = useState<ProviderFilter>(
    () => getLocalStorageJSON<ProviderFilter>(COMPUTE_FILTER_STORAGE_KEY) ?? ALL_PROVIDERS
  );
  useEffect(() => {
    setLocalStorageJSON(COMPUTE_FILTER_STORAGE_KEY, filter);
  }, [filter]);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const { services } = useComputeServices(isConfigured === true);

  // A filter naming a provider that is no longer configured would silently hide
  // everything, so fall back to showing all rather than an empty list.
  const effectiveFilter =
    filter !== ALL_PROVIDERS && configured.includes(filter) ? filter : ALL_PROVIDERS;
  const visible =
    effectiveFilter === ALL_PROVIDERS
      ? services
      : services.filter((s) => s.provider === effectiveFilter);

  if (metadataLoading) {
    return <LoadingState />;
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-[rgb(var(--semantic-1))]">
      <ComputeSidebar
        configured={configured}
        filter={effectiveFilter}
        setFilter={setFilter}
        serviceCount={visible.length}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />
      <div className="min-w-0 flex-1 overflow-hidden">
        {/* Unconfigured keeps the tab's shape — sidebar present, entries dimmed —
            and puts the quick start where a sub-page would be, rather than
            replacing the whole tab with something that reads as an error. */}
        {isConfigured === false ? (
          <ComputeQuickStart onOpenSettings={() => setIsSettingsOpen(true)} />
        ) : (
          <Outlet
            context={
              {
                services: visible,
                configured,
                defaultProvider: compute?.defaultProvider,
                filter: effectiveFilter,
                openSettings: () => setIsSettingsOpen(true),
              } satisfies ComputeOutletContext
            }
          />
        )}
      </div>
      <ComputeSettingsDialog
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        configured={configured}
        defaultProvider={compute?.defaultProvider}
      />
    </div>
  );
}
