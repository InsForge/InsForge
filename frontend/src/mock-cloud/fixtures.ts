// Dev-only fixtures for VITE_MOCK_CLOUD mode. Tree-shaken out of production builds.
import type {
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
  instanceType: 'standard-1',
  latestVersion: 'v2.0.7',
  currentVersion: 'v2.0.7',
  status: 'active',
};

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
    manualBackups: [],
    scheduledBackups: [],
  }),
  onCreateBackup: async () => {},
  onDeleteBackup: async () => {},
  onRenameBackup: async () => {},
  onRestoreBackup: async () => {},
  onRequestInstanceInfo: async () => ({
    currentInstanceType: 'standard-1',
    planName: 'Mock Plan',
    computeCredits: 0,
    currentOrgComputeCost: 0,
    instanceTypes: [],
    projects: [],
  }),
  onRequestInstanceTypeChange: async () => ({ success: true, instanceType: 'standard-1' }),
  onUpdateVersion: async () => {},
  onRequestUserInfo: async () => ({
    userId: 'mock-user-id',
    email: 'mock@insforge.dev',
    name: 'Mock User',
  }),
};
