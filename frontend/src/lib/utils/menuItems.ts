import {
  type LucideIcon,
  Home,
  Database,
  Lock,
  HardDrive,
  Code2,
  Radio,
  Sparkles,
  ChartLine,
  BookOpen,
  GitFork,
  Users,
  Table,
  ChartBarBig,
  Settings,
  Rocket,
} from 'lucide-react';
import { postMessageToParent } from './cloudMessaging';

export interface SecondaryMenuItem {
  id: string;
  label: string;
  href: string;
  sectionEnd?: boolean; // Add support for separator after the item
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
        sectionEnd: true,
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
      {
        id: 'schedules',
        label: 'Schedules',
        href: '/dashboard/functions/schedules',
      },
    ],
  },
  {
    id: 'realtime',
    label: 'Realtime',
    href: '/dashboard/realtime',
    icon: Radio,
    secondaryMenu: [
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
    ],
  },
  {
    id: 'ai',
    label: 'Model Gateway',
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
 * Bottom menu items that may be conditionally shown
 */
export const documentationMenuItem: PrimaryMenuItem = {
  id: 'documentation',
  label: 'Documentation',
  href: 'https://docs.insforge.dev',
  icon: BookOpen,
  external: true,
};

export const usageMenuItem: PrimaryMenuItem = {
  id: 'usage',
  label: 'Usage',
  href: '',
  icon: ChartBarBig,
  onClick: () => {
    postMessageToParent({ type: 'NAVIGATE_TO_USAGE' }, '*');
  },
};

export const settingsMenuItem: PrimaryMenuItem = {
  id: 'settings',
  label: 'Settings',
  href: '/dashboard/settings',
  icon: Settings,
};

export const deploymentsMenuItem: PrimaryMenuItem = {
  id: 'deployments',
  label: 'Deployments',
  href: '/dashboard/deployments',
  icon: Rocket,
  secondaryMenu: [
    {
      id: 'deployment-overview',
      label: 'Overview',
      href: '/dashboard/deployments/overview',
    },
    {
      id: 'deployment-logs',
      label: 'Deployment Logs',
      href: '/dashboard/deployments/logs',
    },
    {
      id: 'deployment-env-vars',
      label: 'Environment Variables',
      href: '/dashboard/deployments/env-vars',
    },
  ],
};
