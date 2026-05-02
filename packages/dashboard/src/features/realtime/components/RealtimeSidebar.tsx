import { useState } from 'react';
import { Settings } from 'lucide-react';
import {
  FeatureSidebar,
  type FeatureSidebarHeaderButton,
  type FeatureSidebarListItem,
} from '#components';
import { RealtimeSettingsMenuDialog } from './RealtimeSettingsMenuDialog';

const REALTIME_SIDEBAR_ITEMS: FeatureSidebarListItem[] = [
  {
    id: 'channels',
    label: 'Channels',
    href: '/dashboard/realtime/channels',
  },
  {
    id: 'messages',
    label: 'Messages',
    href: '/dashboard/realtime/messages',
  },
  {
    id: 'permissions',
    label: 'Permissions',
    href: '/dashboard/realtime/permissions',
  },
];

const REALTIME_SETTINGS_LABEL = 'Realtime Settings';

export function RealtimeSidebar() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const headerButtons: FeatureSidebarHeaderButton[] = REALTIME_SETTINGS_LABEL
    ? [
        {
          id: 'realtime-settings',
          label: REALTIME_SETTINGS_LABEL,
          icon: Settings,
          onClick: () => setIsSettingsOpen(true),
        },
      ]
    : [];

  return (
    <>
      <FeatureSidebar
        title="Realtime"
        items={REALTIME_SIDEBAR_ITEMS}
        headerButtons={headerButtons}
      />
      <RealtimeSettingsMenuDialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen} />
    </>
  );
}
