import { Routes, Route, Navigate } from 'react-router-dom';
import { RequireAuth } from './RequireAuth';
import AppLayout from '../layout/AppLayout';
import LoginPage from '../features/login/pages/LoginPage';
import CloudLoginPage from '../features/login/pages/CloudLoginPage';
import DashboardLayout from '../features/dashboard/components/DashboardLayout';
import DashboardPage from '../features/dashboard/pages/DashboardPage';
import DTestDashboardPage from '../features/dashboard/pages/DTestDashboardPage';
import DTestInstallPage from '../features/dashboard/pages/DTestInstallPage';
import { getFeatureFlag } from '../lib/analytics/posthog';
import DatabaseLayout from '../features/database/components/DatabaseLayout';
import SQLEditorLayout from '../features/database/components/SQLEditorLayout';
import TablesPage from '../features/database/pages/TablesPage';
import AuthenticationLayout from '../features/auth/components/AuthenticationLayout';
import UsersPage from '../features/auth/pages/UsersPage';
import AuthMethodsPage from '../features/auth/pages/AuthMethodsPage';
import EmailPage from '../features/auth/pages/EmailPage';
import LogsLayout from '../features/logs/components/LogsLayout';
import LogsPage from '../features/logs/pages/LogsPage';
import FunctionLogsPage from '../features/logs/pages/FunctionLogsPage';
import MCPLogsPage from '../features/logs/pages/MCPLogsPage';
import StorageLayout from '../features/storage/components/StorageLayout';
import BucketsPage from '../features/storage/pages/BucketsPage';
import VisualizerLayout from '../features/visualizer/components/VisualizerLayout';
import VisualizerPage from '../features/visualizer/pages/VisualizerPage';
import FunctionsLayout from '../features/functions/components/FunctionsLayout';
import FunctionsPage from '../features/functions/pages/FunctionsPage';
import SecretsPage from '../features/functions/pages/SecretsPage';
import SchedulesPage from '../features/functions/pages/SchedulesPage';
import AILayout from '../features/ai/components/AILayout';
import AIPage from '../features/ai/pages/AIPage';
import PaymentsLayout from '../features/payments/components/PaymentsLayout';
import ProductsPage from '../features/payments/pages/ProductsPage';
import RealtimeLayout from '../features/realtime/components/RealtimeLayout';
import RealtimeChannelsPage from '../features/realtime/pages/RealtimeChannelsPage';
import RealtimeMessagesPage from '../features/realtime/pages/RealtimeMessagesPage';
import RealtimePermissionsPage from '../features/realtime/pages/RealtimePermissionsPage';
import SQLEditorPage from '../features/database/pages/SQLEditorPage';
import IndexesPage from '../features/database/pages/IndexesPage';
import DatabaseFunctionsPage from '../features/database/pages/FunctionsPage';
import TriggersPage from '../features/database/pages/TriggersPage';
import PoliciesPage from '../features/database/pages/PoliciesPage';
import TemplatesPage from '../features/database/pages/TemplatesPage';
import MigrationsPage from '../features/database/pages/MigrationsPage';
import BackupsPage from '../features/database/pages/BackupsPage';
import AuditsPage from '../features/logs/pages/AuditsPage';
import DeploymentsLayout from '../features/deployments/components/DeploymentsLayout';
import DeploymentLogsPage from '../features/deployments/pages/DeploymentLogsPage';
import DeploymentOverviewPage from '../features/deployments/pages/DeploymentOverviewPage';
import DeploymentEnvVarsPage from '../features/deployments/pages/DeploymentEnvVarsPage';
import DeploymentDomainsPage from '../features/deployments/pages/DeploymentDomainsPage';

function AuthenticatedRoutes() {
  const dashboardVariant = getFeatureFlag('dashboard-v4-experiment');
  const isDTest = dashboardVariant === 'd_test';
  const DashboardHomePage = isDTest ? DTestDashboardPage : DashboardPage;

  return (
    <AppLayout>
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
          <Route index element={<AIPage />} />
        </Route>
        <Route path="/dashboard/payments" element={<PaymentsLayout />}>
          <Route index element={<Navigate to="products" replace />} />
          <Route path="products" element={<ProductsPage />} />
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
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AppLayout>
  );
}

export function AppRoutes() {
  return (
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
  );
}
