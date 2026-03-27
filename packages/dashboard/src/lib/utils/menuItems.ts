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
  ChartBarBig,
  Settings,
  Rocket,
  SquarePen,
} from 'lucide-react';
import { postMessageToParent } from './cloudMessaging';

export interface PrimaryMenuItem {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  onClick?: () => void;
  external?: boolean;
  sectionEnd?: boolean;
}

/**
 * Static menu items configuration
 * Primary menu items appear in the app sidebar
 */
export const staticMenuItems: PrimaryMenuItem[] = [
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
    icon: Lock,
  },
  {
    id: 'database',
    label: 'Database',
    href: '/dashboard/database',
    icon: Database,
  },
  {
    id: 'storage',
    label: 'Storage',
    href: '/dashboard/storage',
    icon: HardDrive,
    sectionEnd: true,
  },
  {
    id: 'sql-editor',
    label: 'SQL Editor',
    href: '/dashboard/sql-editor',
    icon: SquarePen,
  },
  {
    id: 'functions',
    label: 'Functions',
    href: '/dashboard/functions',
    icon: Code2,
  },
  {
    id: 'realtime',
    label: 'Realtime',
    href: '/dashboard/realtime',
    icon: Radio,
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
  href: '',
  icon: Settings,
};

export const deploymentsMenuItem: PrimaryMenuItem = {
  id: 'deployments',
  label: 'Deployments',
  href: '/dashboard/deployments',
  icon: Rocket,
};
