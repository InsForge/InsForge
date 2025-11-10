import {
  type LucideIcon,
  Home,
  Database,
  Lock,
  HardDrive,
  Code2,
  Sparkles,
  ChartLine,
  RotateCw,
  Link2,
  BookOpen,
  GitFork,
  Settings,
  Users,
  Table,
} from 'lucide-react';
import { postMessageToParent } from './cloudMessaging';

export interface SecondaryMenuItem {
  id: string;
  label: string;
  href: string;
  separator?: boolean; // Add support for separator before the item
}

export interface PrimaryMenuItem {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  secondaryMenu?: SecondaryMenuItem[];
  onClick?: () => void;
  external?: boolean;
  sectionEnd?: boolean;
}

/**
 * Static menu items configuration
 * Primary menu items appear as icons in the left sidebar
 * Secondary menu items appear in a collapsed sidebar when a primary item is selected
 */
export const staticMenuItems: PrimaryMenuItem[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    href: '/dashboard',
    icon: Home,
  },
  {
    id: 'users',
    label: 'Users',
    href: '/dashboard/users',
    icon: Users,
  },
  {
    id: 'tables',
    label: 'Tables',
    href: '/dashboard/tables',
    icon: Table,
    sectionEnd: true,
  },
  {
    id: 'authentication',
    label: 'Authentication',
    href: '/dashboard/authentication',
    icon: Lock,
    secondaryMenu: [
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
        id: 'indexes',
        label: 'Indexes',
        href: '/dashboard/database/indexes',
      },
      {
        id: 'functions',
        label: 'Functions',
        href: '/dashboard/database/functions',
      },
      {
        id: 'triggers',
        label: 'Triggers',
        href: '/dashboard/database/triggers',
      },
      {
        id: 'policies',
        label: 'Policies',
        href: '/dashboard/database/policies',
      },
      {
        id: 'sql-editor',
        label: 'SQL Editor',
        href: '/dashboard/database/sql-editor',
      },
      {
        id: 'templates',
        label: 'Templates',
        href: '/dashboard/database/templates',
        separator: true,
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
    sectionEnd: true,
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
 * Get started menu item for onboarding
 */
export const getStartedMenuItem: PrimaryMenuItem = {
  id: 'get-started',
  label: 'Get Started',
  href: '/dashboard/onboard',
  icon: Link2,
};

/**
 * Bottom menu items that may be conditionally shown
 */
export const documentationMenuItem: PrimaryMenuItem = {
  id: 'documentation',
  label: 'Documentation',
  href: 'https://docs.insforge.dev',
  icon: BookOpen,
  external: true,
};

export const reinstallMenuItem: PrimaryMenuItem = {
  id: 'reinstall',
  label: 'Reinstall',
  href: '/dashboard/onboard',
  icon: RotateCw,
  external: false,
};

export const settingsMenuItem: PrimaryMenuItem = {
  id: 'settings',
  label: 'Settings',
  href: '',
  icon: Settings,
  onClick: () => {
    postMessageToParent({ type: 'SHOW_SETTINGS_OVERLAY' }, '*');
  },
};
