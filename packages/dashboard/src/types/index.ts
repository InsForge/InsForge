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

export interface DashboardUserInfo {
  userId: string;
  email: string;
  name?: string;
}

export interface DashboardBackup {
  id: string;
  name: string | null;
  triggerSource: 'manual' | 'scheduled';
  status: 'running' | 'completed' | string;
  sizeBytes: number | null;
  expiresAt?: string | null;
  createdAt: string;
  createdBy: string | null;
}

export interface DashboardBackupInfo {
  manualBackups: DashboardBackup[];
  scheduledBackups: DashboardBackup[];
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
  onRequestBackupInfo?: () => Promise<DashboardBackupInfo>;
  onCreateBackup?: (name: string) => Promise<void>;
  onDeleteBackup?: (backupId: string) => Promise<void>;
  onRenameBackup?: (backupId: string, name: string | null) => Promise<void>;
  onRestoreBackup?: (backupId: string) => Promise<void>;
  onRequestInstanceInfo?: () => Promise<DashboardInstanceInfo>;
  onRequestInstanceTypeChange?: (
    instanceType: string
  ) => Promise<{ success: boolean; instanceType?: string; error?: string }>;
  onUpdateVersion?: () => Promise<void>;
  onRequestUserInfo?: () => Promise<DashboardUserInfo>;
  onRequestUserApiKey?: () => Promise<string>;
}

export interface SelfHostingDashboardProps extends DashboardProps {
  mode: 'self-hosting';
}

export interface CloudHostingDashboardProps extends DashboardProps {
  mode: 'cloud-hosting';
  getAuthorizationCode: () => Promise<string>;
  useAuthorizationCodeRefresh?: boolean;
}

export type InsForgeDashboardProps = SelfHostingDashboardProps | CloudHostingDashboardProps;
