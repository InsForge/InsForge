import { useTranslation } from 'react-i18next';
import { Settings } from 'lucide-react';
import {
  FeatureSidebar,
  type FeatureSidebarListItem,
  type FeatureSidebarHeaderButton,
} from '#components';
import { COMPUTE_PROVIDERS } from '#features/compute/constants';

interface ComputeSidebarProps {
  onOpenSettings: () => void;
}

/**
 * Secondary nav for the compute tab: one entry per provider.
 *
 * Provider is the navigation axis rather than a filter control, so selecting Docker
 * or Fly.io shows that provider's services in the main area. Both are always listed
 * even when unconfigured — a self-hoster who cannot see Docker in the nav has no way
 * to discover it exists, which was the original complaint. Selecting one that is not
 * set up shows how to set it up, so the entry is useful either way.
 */
export function ComputeSidebar({ onOpenSettings }: ComputeSidebarProps) {
  const { t } = useTranslation('chrome');

  const items: FeatureSidebarListItem[] = COMPUTE_PROVIDERS.map((provider) => ({
    id: provider.slug,
    label: provider.label,
    href: `/dashboard/compute/${provider.slug}`,
  }));

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
    />
  );
}
