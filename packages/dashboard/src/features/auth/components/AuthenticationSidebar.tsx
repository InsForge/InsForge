import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Settings } from 'lucide-react';
import {
  FeatureSidebar,
  type FeatureSidebarHeaderButton,
  type FeatureSidebarListItem,
} from '#components';
import { AuthSettingsMenuDialog } from './AuthSettingsMenuDialog';

export function AuthenticationSidebar() {
  const { t } = useTranslation('chrome');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const sidebarItems: FeatureSidebarListItem[] = [
    {
      id: 'users-list',
      label: t('auth.users', { defaultValue: 'Users' }),
      href: '/dashboard/authentication/users',
    },
    {
      id: 'auth-methods',
      label: t('auth.authMethods', { defaultValue: 'Auth Methods' }),
      href: '/dashboard/authentication/auth-methods',
    },
    {
      id: 'email',
      label: t('auth.customSmtp', { defaultValue: 'Custom SMTP' }),
      href: '/dashboard/authentication/email',
    },
  ];

  const headerButtons: FeatureSidebarHeaderButton[] = [
    {
      id: 'authentication-settings',
      label: t('auth.authenticationSettings', { defaultValue: 'Authentication Settings' }),
      icon: Settings,
      onClick: () => setIsSettingsOpen(true),
    },
  ];

  return (
    <>
      <FeatureSidebar
        title={t('auth.authentication', { defaultValue: 'Authentication' })}
        items={sidebarItems}
        headerButtons={headerButtons}
      />
      <AuthSettingsMenuDialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen} />
    </>
  );
}
