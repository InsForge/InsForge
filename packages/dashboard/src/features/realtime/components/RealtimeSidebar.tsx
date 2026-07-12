import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Settings } from 'lucide-react';
import {
  FeatureSidebar,
  type FeatureSidebarHeaderButton,
  type FeatureSidebarListItem,
} from '#components';
import { RealtimeSettingsMenuDialog } from './RealtimeSettingsMenuDialog';

export function RealtimeSidebar() {
  const { t } = useTranslation('chrome');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const sidebarItems: FeatureSidebarListItem[] = [
    {
      id: 'channels',
      label: t('realtime.channels', { defaultValue: 'Channels' }),
      href: '/dashboard/realtime/channels',
    },
    {
      id: 'messages',
      label: t('realtime.messages', { defaultValue: 'Messages' }),
      href: '/dashboard/realtime/messages',
    },
    {
      id: 'permissions',
      label: t('realtime.permissions', { defaultValue: 'Permissions' }),
      href: '/dashboard/realtime/permissions',
    },
  ];

  const headerButtons: FeatureSidebarHeaderButton[] = [
    {
      id: 'realtime-settings',
      label: t('realtime.realtimeSettings', { defaultValue: 'Realtime Settings' }),
      icon: Settings,
      onClick: () => setIsSettingsOpen(true),
    },
  ];

  return (
    <>
      <FeatureSidebar
        title={t('realtime.realtime', { defaultValue: 'Realtime' })}
        items={sidebarItems}
        headerButtons={headerButtons}
      />
      <RealtimeSettingsMenuDialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen} />
    </>
  );
}
