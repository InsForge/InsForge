import { useTranslation } from 'react-i18next';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, cn } from '@insforge/ui';
import { Settings } from 'lucide-react';
import {
  FeatureSidebar,
  type FeatureSidebarListItem,
  type FeatureSidebarHeaderButton,
} from '#components/FeatureSidebar';
import { ALL_PROVIDERS, type ProviderFilter } from '#features/compute/constants';

interface ComputeSidebarProps {
  /** Providers the backend reports as configured, in the order it reported them. */
  configured: string[];
  defaultProvider: string | undefined;
  filter: ProviderFilter;
  setFilter: (filter: ProviderFilter) => void;
  serviceCount: number;
  onOpenSettings: () => void;
}

/**
 * Secondary nav for the compute tab, in the shape the payments tab established.
 *
 * The provider control is a **filter**, not a switch. Which provider a deployment
 * uses comes from environment variables — a mounted Docker socket, `FLY_API_TOKEN`,
 * `COMPUTE_PROVIDER` — and changing it needs a container restart, so there is
 * nothing the dashboard could switch. What it can usefully do is narrow the list,
 * because providers coexist and the backend routes per service row.
 *
 * So the select only appears when more than one provider is configured. Offering a
 * one-item dropdown would be a control that does nothing, which is the same mistake
 * as offering a region picker to a single-host driver.
 */
export function ComputeSidebar({
  configured,
  defaultProvider,
  filter,
  setFilter,
  serviceCount,
  onOpenSettings,
}: ComputeSidebarProps) {
  const { t } = useTranslation('chrome');

  // Nothing configured means nothing to navigate to, but the menu stays visible with
  // its entries dimmed — the same treatment the payments tab gives an unconnected
  // provider. Replacing the whole tab with an error made it look broken rather than
  // unconfigured.
  const notConfigured = configured.length === 0;

  const items: FeatureSidebarListItem[] = [
    {
      id: 'services',
      label:
        serviceCount > 0
          ? `${t('compute.navServices', { defaultValue: 'Services' })} (${serviceCount})`
          : t('compute.navServices', { defaultValue: 'Services' }),
      href: '/dashboard/compute/services',
      disabled: notConfigured,
    },
    {
      id: 'settings',
      label: t('compute.navSettings', { defaultValue: 'Settings' }),
      href: '/dashboard/compute/settings',
      disabled: notConfigured,
    },
  ];

  const headerButtons: FeatureSidebarHeaderButton[] = [
    {
      id: 'compute-settings',
      label: t('compute.settingsTitle', { defaultValue: 'Compute Settings' }),
      icon: Settings,
      onClick: onOpenSettings,
    },
  ];

  return (
    <FeatureSidebar
      title={t('compute.sidebarTitle', { defaultValue: 'Compute' })}
      items={items}
      headerButtons={headerButtons}
      activeItemId={notConfigured ? null : undefined}
      headerContent={
        <div className="flex flex-col gap-3">
          {configured.length > 1 && (
            <Select value={filter} onValueChange={(v) => setFilter(v as ProviderFilter)}>
              <SelectTrigger
                className="h-8 w-full rounded"
                aria-label={t('compute.providerFilterAriaLabel', {
                  defaultValue: 'Filter services by provider',
                })}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="w-[216px]">
                <SelectItem value={ALL_PROVIDERS}>
                  {t('compute.allProviders', { defaultValue: 'All providers' })}
                </SelectItem>
                {configured.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Which providers are usable, and which one new services go to. Reading
              this off the sidebar is the answer to "is my Docker socket working". */}
          <div className="flex flex-col gap-1">
            {configured.map((p) => (
              <div key={p} className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-green-500" aria-hidden />
                <span className="text-foreground">{p}</span>
                {p === defaultProvider && (
                  <span className={cn('text-[10px] uppercase tracking-wide')}>
                    {t('compute.defaultProviderTag', { defaultValue: 'default' })}
                  </span>
                )}
              </div>
            ))}
          </div>

          {notConfigured && (
            <p className="text-xs text-muted-foreground">
              {t('compute.sidebarNotConfigured', { defaultValue: 'No provider configured yet' })}
            </p>
          )}

          <div className="h-px w-full bg-alpha-8" />
        </div>
      }
    />
  );
}
