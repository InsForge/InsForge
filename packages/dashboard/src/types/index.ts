export type DashboardMode = 'self-hosting' | 'cloud-hosting';

export interface DashboardRoute {
  path: string;
}

export interface DashboardProjectInfo {
  id: string;
  name: string;
  region: string;
  instanceType: string;
  latestVersion?: string | null;
  currentVersion?: string | null;
  status?: 'active' | 'paused' | 'restoring' | string;
}

export interface DashboardCapabilities {
  canManageProjectSettings?: boolean;
  canDeleteProject?: boolean;
  canRenameProject?: boolean;
  canManageInstance?: boolean;
  canManageVersion?: boolean;
  canOpenUsagePage?: boolean;
  canOpenSubscriptionPage?: boolean;
}

export type DashboardAuthConfig =
  | {
      strategy: 'session';
    }
  | {
      strategy: 'authorization-code';
      getAuthorizationCode: () => Promise<string>;
    };

export interface DashboardInstanceInfo {
  currentInstanceType: string;
  planName: string;
  computeCredits: number;
  currentOrgComputeCost: number;
  instanceTypes: Array<{
    id: string;
    name: string;
    cpu: string;
    ram: string;
    pricePerHour: number;
    pricePerMonth: number;
  }>;
  projects: Array<{
    name: string;
    instanceType: string;
    monthlyCost: number;
    isCurrent: boolean;
    status: string;
  }>;
}

export interface DashboardSharedProps {
  backendUrl: string;
  initialPath?: string;
  showNavbar?: boolean;
  project?: DashboardProjectInfo;
  capabilities?: DashboardCapabilities;
  connectDialogOpen?: boolean;
  onConnectDialogOpenChange?: (open: boolean) => void;
  onRouteChange?: (route: DashboardRoute) => void;
  onOpenSettings?: () => void;
  onNavigateToUsage?: () => void;
  onNavigateToSubscription?: () => void;
  onRenameProject?: (name: string) => Promise<void>;
  onDeleteProject?: () => Promise<void>;
  onRequestInstanceInfo?: () => Promise<DashboardInstanceInfo>;
  onRequestInstanceTypeChange?: (
    instanceType: string
  ) => Promise<{ success: boolean; instanceType?: string; error?: string }>;
  onUpdateVersion?: () => Promise<void>;
}

export interface SelfHostingDashboardProps extends DashboardSharedProps {
  mode: 'self-hosting';
  auth?: Extract<DashboardAuthConfig, { strategy: 'session' }>;
}

export interface CloudHostingDashboardProps extends DashboardSharedProps {
  mode: 'cloud-hosting';
  auth: DashboardAuthConfig;
}

export type DashboardProps = SelfHostingDashboardProps | CloudHostingDashboardProps;
export type InsForgeDashboardProps = DashboardProps;
