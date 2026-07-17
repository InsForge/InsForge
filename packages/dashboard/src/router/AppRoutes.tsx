import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { LoadingState } from '@insforge/ui';
import { RequireAuth } from './RequireAuth';
import AppLayout from '#layout/AppLayout';
import { getFeatureFlag } from '#lib/analytics/posthog';
import { FEATURE_FLAGS, FEATURE_FLAG_VARIANTS } from '#lib/analytics/constants';
import { useIsCloudHostingMode } from '#lib/config/DashboardHostContext';

// Core Layouts (kept static for initial render performance of the shell)
import AuthenticationLayout from '#features/auth/components/AuthenticationLayout';
import DashboardLayout from '#features/dashboard/components/DashboardLayout';
import DatabaseLayout from '#features/database/components/DatabaseLayout';
import DeploymentsLayout from '#features/deployments/components/DeploymentsLayout';
import FunctionsLayout from '#features/functions/components/FunctionsLayout';
import LogsLayout from '#features/logs/components/LogsLayout';
import StorageLayout from '#features/storage/components/StorageLayout';

// Lazy load feature layouts & pages
const AILayout = lazy(() => import('#features/ai/components/AILayout'));
const AIOverviewPage = lazy(() => import('#features/ai/pages/AIOverviewPage'));
const AIQuickStartPage = lazy(() => import('#features/ai/pages/AIQuickStartPage'));
const AIModelsPage = lazy(() => import('#features/ai/pages/AIModelsPage'));

const AnalyticsLayout = lazy(() => import('#features/analytics/components/AnalyticsLayout'));
const TrafficPage = lazy(() =>
  import('#features/analytics/pages/TrafficPage').then((m) => ({ default: m.TrafficPage }))
);
const RetentionPage = lazy(() =>
  import('#features/analytics/pages/RetentionPage').then((m) => ({ default: m.RetentionPage }))
);
const SessionReplayPage = lazy(() =>
  import('#features/analytics/pages/SessionReplayPage').then((m) => ({
    default: m.SessionReplayPage,
  }))
);

const WebscraperLayout = lazy(() => import('#features/webscraper/components/WebscraperLayout'));
const WebscraperActorsPage = lazy(() =>
  import('#features/webscraper/pages/WebscraperActorsPage').then((m) => ({
    default: m.WebscraperActorsPage,
  }))
);
const WebscraperRunsPage = lazy(() =>
  import('#features/webscraper/pages/WebscraperRunsPage').then((m) => ({
    default: m.WebscraperRunsPage,
  }))
);
const WebscraperDatasetPage = lazy(() =>
  import('#features/webscraper/pages/WebscraperDatasetPage').then((m) => ({
    default: m.WebscraperDatasetPage,
  }))
);

const AuthMethodsPage = lazy(() => import('#features/auth/pages/AuthMethodsPage'));
const EmailPage = lazy(() => import('#features/auth/pages/EmailPage'));
const UsersPage = lazy(() => import('#features/auth/pages/UsersPage'));

const ComputePage = lazy(() => import('#features/compute/pages/ComputePage'));

const DashboardPage = lazy(() => import('#features/dashboard/pages/DashboardPage'));
const DTestDashboardPage = lazy(() => import('#features/dashboard/pages/DTestDashboardPage'));
const DTestInstallPage = lazy(() => import('#features/dashboard/pages/DTestInstallPage'));

const SQLEditorLayout = lazy(() => import('#features/database/components/SQLEditorLayout'));
const BackupsPage = lazy(() => import('#features/database/pages/BackupsPage'));
const DatabaseFunctionsPage = lazy(() => import('#features/database/pages/FunctionsPage'));
const IndexesPage = lazy(() => import('#features/database/pages/IndexesPage'));
const MigrationsPage = lazy(() => import('#features/database/pages/MigrationsPage'));
const PoliciesPage = lazy(() => import('#features/database/pages/PoliciesPage'));
const SQLEditorPage = lazy(() => import('#features/database/pages/SQLEditorPage'));
const TablesPage = lazy(() => import('#features/database/pages/TablesPage'));
const TemplatesPage = lazy(() => import('#features/database/pages/TemplatesPage'));
const TriggersPage = lazy(() => import('#features/database/pages/TriggersPage'));

const DeploymentDomainsPage = lazy(
  () => import('#features/deployments/pages/DeploymentDomainsPage')
);
const DeploymentEnvVarsPage = lazy(
  () => import('#features/deployments/pages/DeploymentEnvVarsPage')
);
const DeploymentLogsPage = lazy(() => import('#features/deployments/pages/DeploymentLogsPage'));
const DeploymentOverviewPage = lazy(
  () => import('#features/deployments/pages/DeploymentOverviewPage')
);

const FunctionsPage = lazy(() => import('#features/functions/pages/FunctionsPage'));
const SchedulesPage = lazy(() => import('#features/functions/pages/SchedulesPage'));
const SecretsPage = lazy(() => import('#features/functions/pages/SecretsPage'));

const CloudLoginPage = lazy(() => import('#features/login/pages/CloudLoginPage'));
const LoginPage = lazy(() => import('#features/login/pages/LoginPage'));

const AuditsPage = lazy(() => import('#features/logs/pages/AuditsPage'));
const FunctionLogsPage = lazy(() => import('#features/logs/pages/FunctionLogsPage'));
const LogsPage = lazy(() => import('#features/logs/pages/LogsPage'));
const MCPLogsPage = lazy(() => import('#features/logs/pages/MCPLogsPage'));

const PaymentsLayout = lazy(() => import('#features/payments/components/PaymentsLayout'));
const CatalogPage = lazy(() => import('#features/payments/pages/CatalogPage'));
const CustomersPage = lazy(() => import('#features/payments/pages/CustomersPage'));
const SubscriptionsPage = lazy(() => import('#features/payments/pages/SubscriptionsPage'));
const TransactionsPage = lazy(() => import('#features/payments/pages/TransactionsPage'));

const RealtimeLayout = lazy(() => import('#features/realtime/components/RealtimeLayout'));
const RealtimeChannelsPage = lazy(() => import('#features/realtime/pages/RealtimeChannelsPage'));
const RealtimeMessagesPage = lazy(() => import('#features/realtime/pages/RealtimeMessagesPage'));
const RealtimePermissionsPage = lazy(
  () => import('#features/realtime/pages/RealtimePermissionsPage')
);

const BucketsPage = lazy(() => import('#features/storage/pages/BucketsPage'));

const VisualizerLayout = lazy(() => import('#features/visualizer/components/VisualizerLayout'));
const VisualizerPage = lazy(() => import('#features/visualizer/pages/VisualizerPage'));

function AuthenticatedRoutes() {
  const dashboardVariant = getFeatureFlag(FEATURE_FLAGS.DASHBOARD_V4_EXPERIMENT);
  const isDTest = dashboardVariant === FEATURE_FLAG_VARIANTS.D_TEST;
  const DashboardHomePage = isDTest ? DTestDashboardPage : DashboardPage;
  const isCloudHosting = useIsCloudHostingMode();

  return (
    <AppLayout>
      <Suspense fallback={<LoadingState className="py-12" />}>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardLayout />}>
            <Route index element={<DashboardHomePage />} />
            <Route
              path="install"
              element={isDTest ? <DTestInstallPage /> : <Navigate to="/dashboard" replace />}
            />
          </Route>
          <Route path="/dashboard/authentication" element={<AuthenticationLayout />}>
            <Route index element={<Navigate to="users" replace />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="auth-methods" element={<AuthMethodsPage />} />
            <Route path="email" element={<EmailPage />} />
          </Route>
          <Route path="/dashboard/database" element={<DatabaseLayout />}>
            <Route index element={<Navigate to="tables" replace />} />
            <Route path="tables" element={<TablesPage />} />
            <Route path="indexes" element={<IndexesPage />} />
            <Route path="functions" element={<DatabaseFunctionsPage />} />
            <Route path="triggers" element={<TriggersPage />} />
            <Route path="policies" element={<PoliciesPage />} />
            <Route path="sql-editor" element={<Navigate to="/dashboard/sql-editor" replace />} />
            <Route path="templates" element={<TemplatesPage />} />
            <Route path="migrations" element={<MigrationsPage />} />
            <Route path="backups" element={<BackupsPage />} />
          </Route>
          <Route path="/dashboard/sql-editor" element={<SQLEditorLayout />}>
            <Route index element={<SQLEditorPage />} />
          </Route>
          <Route path="/dashboard/storage" element={<StorageLayout />}>
            <Route index element={<BucketsPage />} />
          </Route>
          <Route path="/dashboard/logs" element={<LogsLayout />}>
            <Route index element={<Navigate to="MCP" replace />} />
            <Route path="MCP" element={<MCPLogsPage />} />
            <Route path="audits" element={<AuditsPage />} />
            <Route path="function.logs" element={<FunctionLogsPage />} />
            <Route path=":source" element={<LogsPage />} />
          </Route>
          <Route path="/dashboard/functions" element={<FunctionsLayout />}>
            <Route index element={<Navigate to="list" replace />} />
            <Route path="list" element={<FunctionsPage />} />
            <Route path="secrets" element={<SecretsPage />} />
            <Route path="schedules" element={<SchedulesPage />} />
          </Route>
          <Route path="/dashboard/visualizer" element={<VisualizerLayout />}>
            <Route index element={<VisualizerPage />} />
          </Route>
          <Route path="/dashboard/ai" element={<AILayout />}>
            <Route index element={<Navigate to="overview" replace />} />
            <Route path="overview" element={<AIOverviewPage />} />
            <Route path="quick-start" element={<AIQuickStartPage />} />
            <Route path="models" element={<AIModelsPage />} />
          </Route>
          <Route path="/dashboard/payments" element={<PaymentsLayout />}>
            <Route index element={<Navigate to="catalog" replace />} />
            <Route path="catalog" element={<CatalogPage />} />
            <Route path="customers" element={<CustomersPage />} />
            <Route path="subscriptions" element={<SubscriptionsPage />} />
            <Route path="transactions" element={<TransactionsPage />} />
          </Route>
          <Route path="/dashboard/realtime" element={<RealtimeLayout />}>
            <Route index element={<Navigate to="channels" replace />} />
            <Route path="channels" element={<RealtimeChannelsPage />} />
            <Route path="messages" element={<RealtimeMessagesPage />} />
            <Route path="permissions" element={<RealtimePermissionsPage />} />
          </Route>
          <Route path="/dashboard/deployments" element={<DeploymentsLayout />}>
            <Route index element={<Navigate to="overview" replace />} />
            <Route path="overview" element={<DeploymentOverviewPage />} />
            <Route path="logs" element={<DeploymentLogsPage />} />
            <Route path="env-vars" element={<DeploymentEnvVarsPage />} />
            <Route path="domains" element={<DeploymentDomainsPage />} />
          </Route>
          <Route path="/dashboard/compute" element={<ComputePage />} />
          {isCloudHosting && (
            <Route path="/dashboard/analytics" element={<AnalyticsLayout />}>
              <Route index element={<Navigate to="traffic" replace />} />
              <Route path="traffic" element={<TrafficPage />} />
              <Route path="retention" element={<RetentionPage />} />
              <Route path="session-replay" element={<SessionReplayPage />} />
            </Route>
          )}
          {isCloudHosting && (
            <Route path="/dashboard/webscraper" element={<WebscraperLayout />}>
              <Route index element={<Navigate to="actors" replace />} />
              <Route path="actors" element={<WebscraperActorsPage />} />
              <Route path="runs" element={<WebscraperRunsPage />} />
              <Route path="dataset" element={<WebscraperDatasetPage />} />
            </Route>
          )}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Suspense>
    </AppLayout>
  );
}

export function AppRoutes() {
  return (
    <Suspense
      fallback={<LoadingState className="flex h-screen w-screen items-center justify-center" />}
    >
      <Routes>
        <Route path="/dashboard/login" element={<LoginPage />} />
        <Route path="/cloud/login" element={<CloudLoginPage />} />
        <Route
          path="/*"
          element={
            <RequireAuth>
              <AuthenticatedRoutes />
            </RequireAuth>
          }
        />
      </Routes>
    </Suspense>
  );
}
