import './styles.css';

export { InsForgeDashboard } from './app/InsforgeDashboard';
export { DashboardModalProvider, useDashboardModal } from './modals/DashboardModalContext';
export {
  dashboardDeploymentsMenuItem,
  dashboardSettingsMenuItem,
  dashboardStaticMenuItems,
} from './navigation/menuItems';
export { DashboardHostRoutes } from './router/DashboardHostRoutes';
export { DashboardProtectedBoundary } from './router/DashboardProtectedBoundary';
export { DASHBOARD_LOGIN_PATH } from './router/paths';
export type {
  CloudHostingDashboardProps,
  DashboardInstanceInfo,
  DashboardMode,
  DashboardProjectInfo,
  DashboardProps,
  InsForgeDashboardProps,
  SelfHostingDashboardProps,
} from './types';
export type { DashboardPrimaryMenuItem } from './navigation/menuItems';
export type { DashboardSettingsTab } from './modals/DashboardModalContext';
export type { DashboardHostRoutesProps } from './router/DashboardHostRoutes';
export type { DashboardProtectedBoundaryProps } from './router/DashboardProtectedBoundary';
