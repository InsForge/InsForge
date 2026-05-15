export type DashboardMode = 'self-hosting' | 'cloud-hosting';

export interface DashboardProjectInfo {
  id: string;
  name: string;
  region: string;
  instanceType: string;
  latestVersion?: string | null;
  currentVersion?: string | null;
  status?: string;
  isBranch?: boolean;
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

export interface DashboardModelCreditUsage {
  used: number;
  limit: number;
  isFree: boolean;
}

export type DashboardMetricsRange = '1h' | '6h' | '24h' | '3d';
export type DashboardMetricName =
  | 'cpu_usage'
  | 'memory_usage'
  | 'disk_usage'
  | 'disk_used'
  | 'disk_total'
  | 'network_in'
  | 'network_out';

export interface DashboardMetricDataPoint {
  timestamp: number; // unix seconds
  value: number;
}

export interface DashboardMetricSeries {
  metric: DashboardMetricName;
  instanceId?: string;
  data: DashboardMetricDataPoint[];
}

export interface DashboardMetricsResponse {
  range: DashboardMetricsRange;
  metrics: DashboardMetricSeries[];
}

export type DashboardMetricsError = { kind: 'unavailable' } | { kind: 'error'; message: string };

export type DashboardAdvisorSeverity = 'critical' | 'warning' | 'info';
export type DashboardAdvisorCategory = 'security' | 'performance' | 'health';

export interface DashboardAdvisorSummary {
  scanId: string;
  status: 'running' | 'completed' | 'failed';
  scanType: 'scheduled' | 'manual';
  scannedAt: string; // ISO
  summary: { total: number; critical: number; warning: number; info: number };
}

export interface DashboardAdvisorIssue {
  id: string;
  ruleId: string;
  severity: DashboardAdvisorSeverity;
  category: DashboardAdvisorCategory;
  title: string;
  description: string;
  affectedObject?: string;
  recommendation?: string;
  isResolved: boolean;
}

export interface DashboardAdvisorIssuesResponse {
  issues: DashboardAdvisorIssue[];
  total: number;
}

export interface DashboardAdvisorIssuesQuery {
  severity?: DashboardAdvisorSeverity;
  category?: DashboardAdvisorCategory;
  limit?: number;
  offset?: number;
}

/** Status event posted from cloud-shell after the PostHog OAuth flow finishes. */
export interface DashboardPosthogConnectionStatus {
  status: 'connected' | 'error' | 'cancelled';
  reason?: string;
  timestamp: number;
}

export interface DashboardProps {
  backendUrl?: string;
  showNavbar?: boolean;
  project?: DashboardProjectInfo;
  onRouteChange?: (path: string) => void;
  onShowUpgradeDialog?: () => void;
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
  onRequestModelCredits?: () => Promise<DashboardModelCreditUsage>;
  onRequestProjectMetrics?: (range: DashboardMetricsRange) => Promise<DashboardMetricsResponse>;
  onRequestAdvisorLatest?: () => Promise<DashboardAdvisorSummary | null>;
  onRequestAdvisorIssues?: (
    query: DashboardAdvisorIssuesQuery
  ) => Promise<DashboardAdvisorIssuesResponse>;
  onTriggerAdvisorScan?: () => Promise<void>;
  /** Cloud-hosting only: ask the parent shell to start the PostHog OAuth flow. */
  onConnectPosthog?: (projectId: string) => void;
  /** Cloud-hosting only: subscribe to PostHog OAuth completion / failure events. */
  subscribePosthogConnectionStatus?: (
    cb: (event: DashboardPosthogConnectionStatus) => void
  ) => () => void;
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
