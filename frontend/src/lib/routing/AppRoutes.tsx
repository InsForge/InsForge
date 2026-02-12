import { Routes, Route, Navigate } from 'react-router-dom';
import { RequireAuth } from '@/lib/routing/RequireAuth';
import Layout from '@/components/layout/Layout';
import LoginPage from '@/features/login/pages/LoginPage';
import CloudLoginPage from '@/features/login/pages/CloudLoginPage';
import DashboardPage from '@/features/dashboard/pages/DashboardPage';
import TablesPage from '@/features/database/pages/TablesPage';
import UsersPage from '@/features/auth/pages/UsersPage';
import AuthMethodsPage from '@/features/auth/pages/AuthMethodsPage';
import ConfigurationPage from '@/features/auth/pages/ConfigurationPage';
import LogsPage from '@/features/logs/pages/LogsPage';
import FunctionLogsPage from '@/features/logs/pages/FunctionLogsPage';
import MCPLogsPage from '@/features/logs/pages/MCPLogsPage';
import StoragePage from '@/features/storage/pages/StoragePage';
import VisualizerPage from '@/features/visualizer/pages/VisualizerPage';
import FunctionsPage from '@/features/functions/pages/FunctionsPage';
import SecretsPage from '@/features/functions/pages/SecretsPage';
import SchedulesPage from '@/features/functions/pages/SchedulesPage';
import AIPage from '@/features/ai/pages/AIPage';
import RealtimeChannelsPage from '@/features/realtime/pages/RealtimeChannelsPage';
import RealtimeMessagesPage from '@/features/realtime/pages/RealtimeMessagesPage';
import RealtimePermissionsPage from '@/features/realtime/pages/RealtimePermissionsPage';
import SQLEditorPage from '@/features/database/pages/SQLEditorPage';
import IndexesPage from '@/features/database/pages/IndexesPage';
import DatabaseFunctionsPage from '@/features/database/pages/FunctionsPage';
import TriggersPage from '@/features/database/pages/TriggersPage';
import PoliciesPage from '@/features/database/pages/PoliciesPage';
import TemplatesPage from '@/features/database/pages/TemplatesPage';
import AuditsPage from '@/features/logs/pages/AuditsPage';
import SettingsPage from '@/features/settings/pages/SettingsPage';
import DeploymentLogsPage from '@/features/deployments/pages/DeploymentLogsPage';
import DeploymentOverviewPage from '@/features/deployments/pages/DeploymentOverviewPage';
import DeploymentEnvVarsPage from '@/features/deployments/pages/DeploymentEnvVarsPage';
import DeploymentDomainsPage from '@/features/deployments/pages/DeploymentDomainsPage';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/dashboard/login" element={<LoginPage />} />
      <Route path="/cloud/login" element={<CloudLoginPage />} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <Layout>
              <Routes>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/dashboard/users" element={<UsersPage />} />
                <Route path="/dashboard/tables" element={<TablesPage />} />
                <Route
                  path="/dashboard/authentication"
                  element={<Navigate to="/dashboard/authentication/auth-methods" replace />}
                />
                <Route path="/dashboard/authentication/users" element={<UsersPage />} />
                <Route
                  path="/dashboard/authentication/auth-methods"
                  element={<AuthMethodsPage />}
                />
                <Route path="/dashboard/authentication/config" element={<ConfigurationPage />} />
                <Route
                  path="/dashboard/database"
                  element={<Navigate to="/dashboard/database/indexes" replace />}
                />
                <Route path="/dashboard/database/tables" element={<TablesPage />} />
                <Route path="/dashboard/database/indexes" element={<IndexesPage />} />
                <Route path="/dashboard/database/functions" element={<DatabaseFunctionsPage />} />
                <Route path="/dashboard/database/triggers" element={<TriggersPage />} />
                <Route path="/dashboard/database/policies" element={<PoliciesPage />} />
                <Route path="/dashboard/database/sql-editor" element={<SQLEditorPage />} />
                <Route path="/dashboard/database/templates" element={<TemplatesPage />} />
                <Route path="/dashboard/storage" element={<StoragePage />} />
                <Route
                  path="/dashboard/logs"
                  element={<Navigate to="/dashboard/logs/MCP" replace />}
                />
                <Route path="/dashboard/logs/MCP" element={<MCPLogsPage />} />
                <Route path="/dashboard/logs/audits" element={<AuditsPage />} />
                <Route path="/dashboard/logs/function.logs" element={<FunctionLogsPage />} />
                <Route path="/dashboard/logs/:source" element={<LogsPage />} />
                <Route
                  path="/dashboard/functions"
                  element={<Navigate to="/dashboard/functions/list" replace />}
                />
                <Route path="/dashboard/functions/list" element={<FunctionsPage />} />
                <Route path="/dashboard/functions/secrets" element={<SecretsPage />} />
                <Route path="/dashboard/functions/schedules" element={<SchedulesPage />} />
                <Route path="/dashboard/visualizer" element={<VisualizerPage />} />
                <Route path="/dashboard/ai" element={<AIPage />} />
                <Route
                  path="/dashboard/realtime"
                  element={<Navigate to="/dashboard/realtime/channels" replace />}
                />
                <Route path="/dashboard/realtime/channels" element={<RealtimeChannelsPage />} />
                <Route path="/dashboard/realtime/messages" element={<RealtimeMessagesPage />} />
                <Route
                  path="/dashboard/realtime/permissions"
                  element={<RealtimePermissionsPage />}
                />
                <Route path="/dashboard/settings" element={<SettingsPage />} />
                <Route
                  path="/dashboard/deployments"
                  element={<Navigate to="/dashboard/deployments/overview" replace />}
                />
                <Route
                  path="/dashboard/deployments/overview"
                  element={<DeploymentOverviewPage />}
                />
                <Route path="/dashboard/deployments/logs" element={<DeploymentLogsPage />} />
                <Route path="/dashboard/deployments/env-vars" element={<DeploymentEnvVarsPage />} />
                <Route path="/dashboard/deployments/domains" element={<DeploymentDomainsPage />} />
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Routes>
            </Layout>
          </RequireAuth>
        }
      />
    </Routes>
  );
}
