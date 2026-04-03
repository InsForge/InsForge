import './styles.css';

export { InsForgeDashboard } from './app/InsforgeDashboard';
export { DashboardFrame } from './layout/DashboardFrame';
export { DashboardModalProvider, useDashboardModal } from './modals/DashboardModalContext';
export {
  dashboardDeploymentsMenuItem,
  dashboardSettingsMenuItem,
  dashboardStaticMenuItems,
} from './navigation/menuItems';
export { DashboardHostRoutes } from './router/DashboardHostRoutes';
export { DashboardProtectedBoundary } from './router/DashboardProtectedBoundary';
export { CLOUD_LOGIN_PATH, DASHBOARD_LOGIN_PATH } from './router/paths';
export type {
  DashboardAuthConfig,
  DashboardCapabilities,
  CloudHostingDashboardProps,
  DashboardInstanceInfo,
  DashboardMode,
  DashboardProjectInfo,
  DashboardProps,
  DashboardSharedProps,
  InsForgeDashboardProps,
  SelfHostingDashboardProps,
} from './types';
export type { DashboardFrameProps, DashboardFrameRenderProps } from './layout/DashboardFrame';
export type { DashboardPrimaryMenuItem } from './navigation/menuItems';
export type { DashboardSettingsTab } from './modals/DashboardModalContext';
export type { DashboardHostRoutesProps } from './router/DashboardHostRoutes';
export type { DashboardProtectedBoundaryProps } from './router/DashboardProtectedBoundary';
