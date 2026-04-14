export type DashboardMode = 'self-hosting' | 'cloud-hosting';

export interface DashboardProjectInfo {
  id: string;
  name: string;
  region: string;
  instanceType: string;
  latestVersion?: string | null;
  currentVersion?: string | null;
  status?: 'active' | 'paused' | 'restoring' | string;
}

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

export interface DashboardProps {
  backendUrl?: string;
  showNavbar?: boolean;
  project?: DashboardProjectInfo;
  onRouteChange?: (path: string) => void;
  onNavigateToSubscription?: () => void;
  onRenameProject?: (name: string) => Promise<void>;
  onDeleteProject?: () => Promise<void>;
  onRequestInstanceInfo?: () => Promise<DashboardInstanceInfo>;
  onRequestInstanceTypeChange?: (
    instanceType: string
  ) => Promise<{ success: boolean; instanceType?: string; error?: string }>;
  onUpdateVersion?: () => Promise<void>;
}

export interface SelfHostingDashboardProps extends DashboardProps {
  mode: 'self-hosting';
}

export interface CloudHostingDashboardProps extends DashboardProps {
  mode: 'cloud-hosting';
  getAuthorizationCode: () => Promise<string>;
}

export type InsForgeDashboardProps = SelfHostingDashboardProps | CloudHostingDashboardProps;
