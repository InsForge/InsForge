import './styles.css';

export { InsForgeDashboard } from './app/InsforgeDashboard';
export { DashboardModalProvider, useDashboardModal } from './modals/DashboardModalContext';
export {
  dashboardDeploymentsMenuItem,
  dashboardSettingsMenuItem,
  dashboardStaticMenuItems,
} from './navigation/menuItems';
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
