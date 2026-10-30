import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Settings } from 'lucide-react';
import {
  FeatureSidebar,
  type FeatureSidebarHeaderButton,
  type FeatureSidebarListItem,
} from '#components';
import { useDashboardHost } from '#lib/config/DashboardHostContext';
import { ModelGatewaySettingsDialog } from './ModelGatewaySettingsDialog';

export function AISidebar() {
  const { t } = useTranslation('chrome');
  const host = useDashboardHost();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const items: FeatureSidebarListItem[] = [
    {
      id: 'overview',
      label: t('ai.sidebar.overview', { defaultValue: 'Overview' }),
      href: '/dashboard/ai/overview',
    },
    {
      id: 'usage',
      label: t('ai.sidebar.usage', { defaultValue: 'Usage' }),
      href: '/dashboard/ai/usage',
    },
    {
      id: 'quick-start',
      label: t('ai.sidebar.quickStart', { defaultValue: 'Quick Start' }),
      href: '/dashboard/ai/quick-start',
    },
    {
      id: 'ai-models',
      label: t('ai.sidebar.models', { defaultValue: 'Models' }),
      href: '/dashboard/ai/models',
    },
  ];

  const headerButtons: FeatureSidebarHeaderButton[] =
    host.mode === 'self-hosting'
      ? [
          {
            id: 'model-gateway-settings',
            label: t('ai.settings.title', { defaultValue: 'Model Gateway Settings' }),
            icon: Settings,
            onClick: () => setSettingsOpen(true),
          },
        ]
      : [];

  return (
    <>
      <FeatureSidebar
        title={t('ai.sidebar.title', { defaultValue: 'Model Gateway' })}
        items={items}
        headerButtons={headerButtons}
      />
      {host.mode === 'self-hosting' ? (
        <ModelGatewaySettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      ) : null}
    </>
  );
}
