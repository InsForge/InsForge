import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Settings } from 'lucide-react';
import type { PosthogConnection } from '@insforge/shared-schemas';
import {
  FeatureSidebar,
  type FeatureSidebarHeaderButton,
  type FeatureSidebarListItem,
} from '#components';
import { AnalyticsConfigDialog } from './AnalyticsConfigDialog';

interface AnalyticsSidebarProps {
  connection: PosthogConnection | null;
  projectId: string;
}

export function AnalyticsSidebar({ connection, projectId }: AnalyticsSidebarProps) {
  const { t } = useTranslation('chrome');
  const [settingsOpen, setSettingsOpen] = useState(false);

  const items: FeatureSidebarListItem[] = [
    {
      id: 'traffic',
      label: t('analytics.sidebar.traffic', { defaultValue: 'Traffic' }),
      href: '/dashboard/analytics/traffic',
    },
    {
      id: 'retention',
      label: t('analytics.sidebar.userRetention', { defaultValue: 'User Retention' }),
      href: '/dashboard/analytics/retention',
    },
    {
      id: 'session-replay',
      label: t('analytics.sidebar.sessionReplay', { defaultValue: 'Session Replay' }),
      href: '/dashboard/analytics/session-replay',
    },
  ];

  const headerButtons: FeatureSidebarHeaderButton[] = [
    {
      id: 'analytics-settings',
      label: t('analytics.config.title', { defaultValue: 'Analytics Config' }),
      icon: Settings,
      onClick: () => setSettingsOpen(true),
      disabled: !projectId,
    },
  ];

  return (
    <>
      <FeatureSidebar
        title={t('analytics.sidebar.title', { defaultValue: 'Analytics' })}
        items={items}
        headerButtons={headerButtons}
      />
      <AnalyticsConfigDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        connection={connection}
        projectId={projectId}
      />
    </>
  );
}
