import { Routes, Route, Navigate } from 'react-router-dom';
import { RequireAuth } from '@/lib/routing/RequireAuth';
import Layout from '@/components/layout/Layout';
import LoginPage from '@/features/login/page/LoginPage';
import CloudLoginPage from '@/features/login/page/CloudLoginPage';
import DashboardPage from '@/features/dashboard/page/DashboardPage';
import TablesPage from '@/features/database/page/TablesPage';
import UsersPage from '@/features/auth/page/UsersPage';
import AuthMethodsPage from '@/features/auth/page/AuthMethodsPage';
import ConfigurationPage from '@/features/auth/page/ConfigurationPage';
import LogsPage from '@/features/logs/page/LogsPage';
import MCPLogsPage from '@/features/logs/page/MCPLogsPage';
import StoragePage from '@/features/storage/page/StoragePage';
import VisualizerPage from '@/features/visualizer/page/VisualizerPage';
import FunctionsPage from '@/features/functions/page/FunctionsPage';
import SecretsPage from '@/features/functions/page/SecretsPage';
import AIPage from '@/features/ai/page/AIPage';
import RealtimeChannelsPage from '@/features/realtime/page/RealtimeChannelsPage';
import RealtimeMessagesPage from '@/features/realtime/page/RealtimeMessagesPage';
import SQLEditorPage from '@/features/database/page/SQLEditorPage';
import IndexesPage from '@/features/database/page/IndexesPage';
import DatabaseFunctionsPage from '@/features/database/page/FunctionsPage';
import TriggersPage from '@/features/database/page/TriggersPage';
import PoliciesPage from '@/features/database/page/PoliciesPage';
import TemplatesPage from '@/features/database/page/TemplatesPage';
import AuditsPage from '@/features/logs/page/AuditsPage';

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
                <Route path="/dashboard/logs/:source" element={<LogsPage />} />
                <Route
                  path="/dashboard/functions"
                  element={<Navigate to="/dashboard/functions/list" replace />}
                />
                <Route path="/dashboard/functions/list" element={<FunctionsPage />} />
                <Route path="/dashboard/functions/secrets" element={<SecretsPage />} />
                <Route path="/dashboard/visualizer" element={<VisualizerPage />} />
                <Route path="/dashboard/ai" element={<AIPage />} />
                <Route
                  path="/dashboard/realtime"
                  element={<Navigate to="/dashboard/realtime/channels" replace />}
                />
                <Route path="/dashboard/realtime/channels" element={<RealtimeChannelsPage />} />
                <Route path="/dashboard/realtime/messages" element={<RealtimeMessagesPage />} />
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Routes>
            </Layout>
          </RequireAuth>
        }
      />
    </Routes>
  );
}
