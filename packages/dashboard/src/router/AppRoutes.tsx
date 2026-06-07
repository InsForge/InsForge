import { Component, lazy, Suspense, type ErrorInfo, type ReactNode } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { ErrorState } from '#components/ErrorState';
import { LoadingState } from '#components/LoadingState';
import { RequireAuth } from './RequireAuth';
import AppLayout from '#layout/AppLayout';
import { getFeatureFlag } from '#lib/analytics/posthog';
import { useIsCloudHostingMode } from '#lib/config/DashboardHostContext';

const AILayout = lazy(() => import('#features/ai/components/AILayout'));
const AIOverviewPage = lazy(() => import('#features/ai/pages/AIOverviewPage'));
const AIQuickStartPage = lazy(() => import('#features/ai/pages/AIQuickStartPage'));
const AIModelsPage = lazy(() => import('#features/ai/pages/AIModelsPage'));
const AnalyticsLayout = lazy(() => import('#features/analytics/components/AnalyticsLayout'));
const TrafficPage = lazy(() =>
  import('#features/analytics/pages/TrafficPage').then((module) => ({
    default: module.TrafficPage,
  }))
);
const RetentionPage = lazy(() =>
  import('#features/analytics/pages/RetentionPage').then((module) => ({
    default: module.RetentionPage,
  }))
);
const SessionReplayPage = lazy(() =>
  import('#features/analytics/pages/SessionReplayPage').then((module) => ({
    default: module.SessionReplayPage,
  }))
);
const AuthenticationLayout = lazy(() => import('#features/auth/components/AuthenticationLayout'));
const AuthMethodsPage = lazy(() => import('#features/auth/pages/AuthMethodsPage'));
const EmailPage = lazy(() => import('#features/auth/pages/EmailPage'));
const UsersPage = lazy(() => import('#features/auth/pages/UsersPage'));
const ComputePage = lazy(() => import('#features/compute/pages/ComputePage'));
const DashboardLayout = lazy(() => import('#features/dashboard/components/DashboardLayout'));
const DashboardPage = lazy(() => import('#features/dashboard/pages/DashboardPage'));
const DTestDashboardPage = lazy(() => import('#features/dashboard/pages/DTestDashboardPage'));
const DTestInstallPage = lazy(() => import('#features/dashboard/pages/DTestInstallPage'));
const DatabaseLayout = lazy(() => import('#features/database/components/DatabaseLayout'));
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
const DeploymentsLayout = lazy(() => import('#features/deployments/components/DeploymentsLayout'));
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
const FunctionsLayout = lazy(() => import('#features/functions/components/FunctionsLayout'));
const FunctionsPage = lazy(() => import('#features/functions/pages/FunctionsPage'));
const SchedulesPage = lazy(() => import('#features/functions/pages/SchedulesPage'));
const SecretsPage = lazy(() => import('#features/functions/pages/SecretsPage'));
const CloudLoginPage = lazy(() => import('#features/login/pages/CloudLoginPage'));
const LoginPage = lazy(() => import('#features/login/pages/LoginPage'));
const LogsLayout = lazy(() => import('#features/logs/components/LogsLayout'));
const AuditsPage = lazy(() => import('#features/logs/pages/AuditsPage'));
const FunctionLogsPage = lazy(() => import('#features/logs/pages/FunctionLogsPage'));
const LogsPage = lazy(() => import('#features/logs/pages/LogsPage'));
const MCPLogsPage = lazy(() => import('#features/logs/pages/MCPLogsPage'));
const PaymentsLayout = lazy(() => import('#features/payments/components/PaymentsLayout'));
const CatalogPage = lazy(() => import('#features/payments/pages/CatalogPage'));
const CustomersPage = lazy(() => import('#features/payments/pages/CustomersPage'));
const PaymentHistoryPage = lazy(() => import('#features/payments/pages/PaymentHistoryPage'));
const SubscriptionsPage = lazy(() => import('#features/payments/pages/SubscriptionsPage'));
const RealtimeLayout = lazy(() => import('#features/realtime/components/RealtimeLayout'));
const RealtimeChannelsPage = lazy(() => import('#features/realtime/pages/RealtimeChannelsPage'));
const RealtimeMessagesPage = lazy(() => import('#features/realtime/pages/RealtimeMessagesPage'));
const RealtimePermissionsPage = lazy(
  () => import('#features/realtime/pages/RealtimePermissionsPage')
);
const StorageLayout = lazy(() => import('#features/storage/components/StorageLayout'));
const BucketsPage = lazy(() => import('#features/storage/pages/BucketsPage'));
const VisualizerLayout = lazy(() => import('#features/visualizer/components/VisualizerLayout'));
const VisualizerPage = lazy(() => import('#features/visualizer/pages/VisualizerPage'));

function RouteLoadingFallback() {
  return <LoadingState className="min-h-[240px]" />;
}

interface ChunkErrorBoundaryProps {
  children: ReactNode;
}

interface ChunkErrorBoundaryState {
  error: Error | null;
}

class ChunkErrorBoundary extends Component<ChunkErrorBoundaryProps, ChunkErrorBoundaryState> {
  state: ChunkErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Dashboard route chunk failed to load', error, errorInfo);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="p-6">
          <ErrorState
            title="Unable to load this page"
            error="The dashboard could not load the latest page assets. Reload the app to try again."
            onRetry={() => window.location.reload()}
          />
        </div>
      );
    }

    return this.props.children;
  }
}

function AuthenticatedRoutes() {
  const dashboardVariant = getFeatureFlag('dashboard-v4-experiment');
  const isDTest = dashboardVariant === 'd_test';
  const DashboardHomePage = isDTest ? DTestDashboardPage : DashboardPage;
  const isCloudHosting = useIsCloudHostingMode();

  return (
    <AppLayout>
      <ChunkErrorBoundary>
        <Suspense fallback={<RouteLoadingFallback />}>
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
              <Route path="payment-history" element={<PaymentHistoryPage />} />
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
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Suspense>
      </ChunkErrorBoundary>
    </AppLayout>
  );
}

export function AppRoutes() {
  return (
    <ChunkErrorBoundary>
      <Suspense fallback={<RouteLoadingFallback />}>
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
    </ChunkErrorBoundary>
  );
}
