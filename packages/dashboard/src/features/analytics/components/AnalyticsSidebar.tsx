import { useState } from 'react';
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
  const [settingsOpen, setSettingsOpen] = useState(false);

  const items: FeatureSidebarListItem[] = [
    {
      id: 'traffic',
      label: 'Traffic',
      href: '/dashboard/analytics/traffic',
    },
    {
      id: 'retention',
      label: 'User Retention',
      href: '/dashboard/analytics/retention',
    },
    {
      id: 'session-replay',
      label: 'Session Replay',
      href: '/dashboard/analytics/session-replay',
    },
  ];

  const headerButtons: FeatureSidebarHeaderButton[] = [
    {
      id: 'analytics-settings',
      label: 'Analytics Config',
      icon: Settings,
      onClick: () => setSettingsOpen(true),
      disabled: !projectId,
    },
  ];

  return (
    <>
      <FeatureSidebar title="Analytics" items={items} headerButtons={headerButtons} />
      <AnalyticsConfigDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        connection={connection}
        projectId={projectId}
      />
    </>
  );
}
