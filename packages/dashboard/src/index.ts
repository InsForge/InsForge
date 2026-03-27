export { InsForgeDashboard } from './app/InsforgeDashboard';
export { DashboardAppShell } from './app/DashboardAppShell';
export { createDashboardQueryClient } from './app/createDashboardQueryClient';
export { DashboardFrame } from './layout/DashboardFrame';
export { DashboardOutletLayout } from './layout/DashboardOutletLayout';
export { DashboardSectionLayout } from './layout/DashboardSectionLayout';
export { DashboardModalProvider, useDashboardModal } from './modals/DashboardModalContext';
export {
  dashboardDeploymentsMenuItem,
  dashboardSettingsMenuItem,
  dashboardStaticMenuItems,
} from './navigation/menuItems';
export { DashboardHostRoutes } from './router/DashboardHostRoutes';
export { DashboardProtectedBoundary } from './router/DashboardProtectedBoundary';
export {
  CLOUD_LOGIN_PATH,
  DASHBOARD_AUTH_USERS_PATH,
  DASHBOARD_DATABASE_TABLES_PATH,
  DASHBOARD_HOME_PATH,
  DASHBOARD_LOGIN_PATH,
} from './router/paths';
export type {
  DashboardAuthConfig,
  DashboardCapabilities,
  CloudHostingDashboardProps,
  DashboardInstanceInfo,
  DashboardMode,
  DashboardProjectInfo,
  DashboardProps,
  DashboardRoute,
  DashboardSharedProps,
  InsForgeDashboardProps,
  SelfHostingDashboardProps,
} from './types';
export type { DashboardAppShellProps } from './app/DashboardAppShell';
export type { DashboardFrameProps, DashboardFrameRenderProps } from './layout/DashboardFrame';
export type { DashboardSectionLayoutProps } from './layout/DashboardSectionLayout';
export type { DashboardPrimaryMenuItem } from './navigation/menuItems';
export type { DashboardSettingsTab } from './modals/DashboardModalContext';
export type { DashboardHostRoutesProps } from './router/DashboardHostRoutes';
export type { DashboardProtectedBoundaryProps } from './router/DashboardProtectedBoundary';
