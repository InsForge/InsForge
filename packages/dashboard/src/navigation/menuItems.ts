import {
  type LucideIcon,
  Home,
  Database,
  Lock,
  HardDrive,
  Code2,
  Radio,
  Server,
  Sparkles,
  ChartLine,
  Settings,
  Rocket,
  SquarePen,
  Download,
  BookOpen,
  CreditCard,
} from 'lucide-react';

export interface DashboardSecondaryMenuItem {
  id: string;
  label: string;
  href: string;
}

export interface DashboardPrimaryMenuItem {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  onClick?: () => void;
  external?: boolean;
  sectionEnd?: boolean;
  secondaryMenu?: DashboardSecondaryMenuItem[];
}

export const dashboardStaticMenuItems: DashboardPrimaryMenuItem[] = [
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
    secondaryMenu: [
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
        label: 'Email',
        href: '/dashboard/authentication/email',
      },
    ],
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
  },
  {
    id: 'compute',
    label: 'Compute',
    href: '/dashboard/compute',
    icon: Server,
  },
  {
    id: 'payments',
    label: 'Payments',
    href: '/dashboard/payments',
    icon: CreditCard,
    sectionEnd: true,
  },
  {
    id: 'logs',
    label: 'Logs',
    href: '/dashboard/logs',
    icon: ChartLine,
  },
];

export const dashboardSettingsMenuItem: DashboardPrimaryMenuItem = {
  id: 'settings',
  label: 'Settings',
  href: '',
  icon: Settings,
};

export const dashboardDeploymentsMenuItem: DashboardPrimaryMenuItem = {
  id: 'deployments',
  label: 'Deployments',
  href: '/dashboard/deployments',
  icon: Rocket,
};

// d_test + cloud-hosting only: navigates to the Install InsForge route.
export const dashboardDTestInstallMenuItem: DashboardPrimaryMenuItem = {
  id: 'dtest-install',
  label: 'Install',
  href: '/dashboard/install',
  icon: Download,
};

// d_test + cloud-hosting only: opens the docs site in a new tab.
export const dashboardDTestDocMenuItem: DashboardPrimaryMenuItem = {
  id: 'dtest-doc',
  label: 'Doc',
  href: 'https://docs.insforge.dev/introduction',
  icon: BookOpen,
  external: true,
};
