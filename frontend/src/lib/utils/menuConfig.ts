import {
  type LucideIcon,
  Home,
  Database,
  UserRoundCog,
  HardDrive,
  Code2,
  Sparkles,
  ChartLine,
  RotateCw,
  Link2,
  BookOpen,
  GitFork,
  Settings,
} from 'lucide-react';
import { isInsForgeCloudProject } from './utils';

export interface SecondaryMenuItem {
  id: string;
  label: string;
  href: string;
}

export interface PrimaryMenuItem {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  secondaryMenu?: SecondaryMenuItem[];
  onClick?: () => void;
  external?: boolean;
}

/**
 * Centralized menu configuration
 * Primary menu items appear as icons in the left sidebar
 * Secondary menu items appear in a collapsed sidebar when a primary item is selected
 */
export const menuConfig: PrimaryMenuItem[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    href: '/dashboard',
    icon: Home,
  },
  {
    id: 'authentication',
    label: 'Authentication',
    href: '/dashboard/authentication',
    icon: UserRoundCog,
    secondaryMenu: [
      {
        id: 'users',
        label: 'Users',
        href: '/dashboard/authentication/users',
      },
      {
        id: 'auth-methods',
        label: 'Auth Methods',
        href: '/dashboard/authentication/auth-methods',
      },
      {
        id: 'configuration',
        label: 'Configurations',
        href: '/dashboard/authentication/config',
      },
    ],
  },
  {
    id: 'database',
    label: 'Database',
    href: '/dashboard/database',
    icon: Database,
    secondaryMenu: [
      {
        id: 'tables',
        label: 'Tables',
        href: '/dashboard/database/tables',
      },
      {
        id: 'sql-editor',
        label: 'SQL Editor',
        href: '/dashboard/database/sql-editor',
      },
    ],
  },
  {
    id: 'storage',
    label: 'Storage',
    href: '/dashboard/storage',
    icon: HardDrive,
  },
  {
    id: 'functions',
    label: 'Functions',
    href: '/dashboard/functions',
    icon: Code2,
    secondaryMenu: [
      {
        id: 'functions-list',
        label: 'Functions',
        href: '/dashboard/functions/list',
      },
      {
        id: 'secrets',
        label: 'Secrets',
        href: '/dashboard/functions/secrets',
      },
    ],
  },
  {
    id: 'ai',
    label: 'AI',
    href: '/dashboard/ai',
    icon: Sparkles,
  },
  {
    id: 'logs',
    label: 'Logs',
    href: '/dashboard/logs',
    icon: ChartLine,
    // Secondary menu is populated dynamically in AppSidebar using useLogSources
  },
  {
    id: 'visualizer',
    label: 'Visualizer',
    href: '/dashboard/visualizer',
    icon: GitFork,
  },
];

/**
 * Dynamic navigation items that appear based on user state
 */
export const getMenuItems = (hasCompletedOnboarding: boolean): PrimaryMenuItem[] => {
  if (hasCompletedOnboarding || isInsForgeCloudProject()) {
    return menuConfig;
  }

  return [
    {
      id: 'get-started',
      label: 'Get Started',
      href: '/dashboard/onboard',
      icon: Link2,
    },
    ...menuConfig,
  ];
};

/**
 * Bottom navigation items (external links, etc.)
 */
export const getBottomMenuItems = (hasCompletedOnboarding: boolean): PrimaryMenuItem[] => {
  const items: PrimaryMenuItem[] = [
    {
      id: 'documentation',
      label: 'Documentation',
      href: 'https://docs.insforge.dev',
      icon: BookOpen,
      external: true,
    },
  ];

  // Add reinstall button if onboarding is completed
  if (hasCompletedOnboarding) {
    items.push({
      id: 'reinstall',
      label: 'Reinstall',
      href: '/dashboard/onboard',
      icon: RotateCw,
      external: false,
    });
  }

  // Add settings button if this is an InsForge Cloud project
  if (isInsForgeCloudProject()) {
    items.push({
      id: 'settings',
      label: 'Settings',
      href: '',
      icon: Settings,
      onClick: () => {
        window.parent.postMessage({ type: 'toggleSettingsOverlay' }, '*');
      },
    });
  }

  return items;
};
