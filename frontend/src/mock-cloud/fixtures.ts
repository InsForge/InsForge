// Dev-only fixtures for VITE_MOCK_CLOUD mode. Tree-shaken out of production builds.
import type {
  DashboardBackup,
  DashboardInstanceInfo,
  DashboardProjectInfo,
  InsForgeDashboardProps,
} from '@insforge/dashboard';

// Runtime flag that packages/dashboard reads to short-circuit cloud detection
// in code paths that cannot see the frontend's Vite env var at build time.
export const MOCK_CLOUD_FLAG = '__INSFORGE_MOCK_CLOUD__';

export const FAKE_PROJECT: DashboardProjectInfo = {
  id: 'mock-project-id',
  name: 'Mock Cloud Project',
  region: 'us-east-1',
  instanceType: 'standard',
  latestVersion: 'v2.0.7',
  currentVersion: 'v2.0.7',
  status: 'active',
};

const FAKE_INSTANCE_TYPES: DashboardInstanceInfo['instanceTypes'] = [
  { id: 'standard', name: 'Standard', cpu: '1 vCPU', ram: '2 GB', pricePerHour: 0.014, pricePerMonth: 10 },
  { id: 'standard-1', name: 'Standard 1', cpu: '2 vCPU', ram: '4 GB', pricePerHour: 0.028, pricePerMonth: 20 },
  { id: 'standard-2', name: 'Standard 2', cpu: '4 vCPU', ram: '8 GB', pricePerHour: 0.055, pricePerMonth: 40 },
  { id: 'standard-3', name: 'Standard 3', cpu: '8 vCPU', ram: '16 GB', pricePerHour: 0.11, pricePerMonth: 80 },
];

const FAKE_INSTANCE_PROJECTS: DashboardInstanceInfo['projects'] = [
  { name: 'Mock Cloud Project', instanceType: 'standard', monthlyCost: 10, isCurrent: true, status: 'active' },
  { name: 'Side Project', instanceType: 'standard-1', monthlyCost: 20, isCurrent: false, status: 'active' },
];

const FAKE_MANUAL_BACKUPS: DashboardBackup[] = [
  {
    id: 'backup-manual-1',
    name: 'Pre-launch snapshot',
    triggerSource: 'manual',
    status: 'completed',
    sizeBytes: 248_576_000,
    expiresAt: '2026-07-15T10:00:00Z',
    createdAt: '2026-04-15T10:00:00Z',
    createdBy: 'mock@insforge.dev',
  },
  {
    id: 'backup-manual-2',
    name: 'Before schema migration',
    triggerSource: 'manual',
    status: 'completed',
    sizeBytes: 312_104_000,
    expiresAt: '2026-07-22T08:30:00Z',
    createdAt: '2026-04-22T08:30:00Z',
    createdBy: 'mock@insforge.dev',
  },
  {
    id: 'backup-manual-3',
    name: 'In-progress checkpoint',
    triggerSource: 'manual',
    status: 'running',
    sizeBytes: null,
    expiresAt: null,
    createdAt: '2026-04-28T09:15:00Z',
    createdBy: 'mock@insforge.dev',
  },
];

const FAKE_SCHEDULED_BACKUPS: DashboardBackup[] = [
  {
    id: 'backup-scheduled-1',
    name: null,
    triggerSource: 'scheduled',
    status: 'completed',
    sizeBytes: 305_400_000,
    expiresAt: '2026-05-26T00:00:00Z',
    createdAt: '2026-04-26T00:00:00Z',
    createdBy: null,
  },
  {
    id: 'backup-scheduled-2',
    name: null,
    triggerSource: 'scheduled',
    status: 'completed',
    sizeBytes: 308_120_000,
    expiresAt: '2026-05-27T00:00:00Z',
    createdAt: '2026-04-27T00:00:00Z',
    createdBy: null,
  },
  {
    id: 'backup-scheduled-3',
    name: null,
    triggerSource: 'scheduled',
    status: 'completed',
    sizeBytes: 311_280_000,
    expiresAt: '2026-05-28T00:00:00Z',
    createdAt: '2026-04-28T00:00:00Z',
    createdBy: null,
  },
];

type CloudProps = Extract<InsForgeDashboardProps, { mode: 'cloud-hosting' }>;

export const STUB_CALLBACKS: Omit<CloudProps, 'mode' | 'project'> = {
  backendUrl: undefined,
  showNavbar: false, // FakeCloudNavbar renders its own top bar instead
  useAuthorizationCodeRefresh: false,
  getAuthorizationCode: async () => 'mock-auth-code',
  onRouteChange: () => {},
  onNavigateToSubscription: () => {
    console.info('[MOCK] onNavigateToSubscription called');
  },
  onRenameProject: async () => {},
  onDeleteProject: async () => {},
  onRequestBackupInfo: async () => ({
    manualBackups: FAKE_MANUAL_BACKUPS,
    scheduledBackups: FAKE_SCHEDULED_BACKUPS,
  }),
  onCreateBackup: async () => {},
  onDeleteBackup: async () => {},
  onRenameBackup: async () => {},
  onRestoreBackup: async () => {},
  onRequestInstanceInfo: async () => ({
    currentInstanceType: 'standard',
    planName: 'Pro (Mock)',
    computeCredits: 50,
    currentOrgComputeCost: 12.34,
    instanceTypes: FAKE_INSTANCE_TYPES,
    projects: FAKE_INSTANCE_PROJECTS,
  }),
  onRequestInstanceTypeChange: async () => ({ success: true, instanceType: 'standard' }),
  onUpdateVersion: async () => {},
  onRequestUserInfo: async () => ({
    userId: 'mock-user-id',
    email: 'mock@insforge.dev',
    name: 'Mock User',
  }),
};
