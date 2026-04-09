import { useState } from 'react';
import { Settings } from 'lucide-react';
import {
  FeatureSidebar,
  type FeatureSidebarHeaderButton,
  type FeatureSidebarListItem,
} from '../../../components';
import { AuthSettingsMenuDialog } from './AuthSettingsMenuDialog';

const AUTHENTICATION_SIDEBAR_ITEMS: FeatureSidebarListItem[] = [
  {
    id: 'users-list',
    label: 'Users',
    href: '/dashboard/authentication/users',
  },
  {
    id: 'auth-methods',
    label: 'Auth Methods',
    href: '/dashboard/authentication/auth-methods',
  },
  {
    id: 'email',
    label: 'Email Providers',
    href: '/dashboard/authentication/email',
  },
];

const AUTHENTICATION_SETTINGS_LABEL = 'Authentication Settings';

export function AuthenticationSidebar() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const headerButtons: FeatureSidebarHeaderButton[] = AUTHENTICATION_SETTINGS_LABEL
    ? [
        {
          id: 'authentication-settings',
          label: AUTHENTICATION_SETTINGS_LABEL,
          icon: Settings,
          onClick: () => setIsSettingsOpen(true),
        },
      ]
    : [];

  return (
    <>
      <FeatureSidebar
        title="Authentication"
        items={AUTHENTICATION_SIDEBAR_ITEMS}
        headerButtons={headerButtons}
      />
      <AuthSettingsMenuDialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen} />
    </>
  );
}
