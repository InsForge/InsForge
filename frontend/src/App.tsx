import { Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/lib/contexts/AuthContext';
import { AuthErrorBoundary } from '@/features/login/components/AuthErrorBoundary';
import { PrivateRoute } from '@/features/login/components/PrivateRoute';
import { ToastProvider } from '@/lib/hooks/useToast';
import LoginPage from './features/login/page/LoginPage';
import DashboardPage from './features/dashboard/page/DashboardPage';
import DatabasePage from './features/database/page/DatabasePage';
import AuthenticationPage from './features/auth/page/AuthenticationPage';
import LogsPage from './features/logs/page/LogsPage';
import AnalyticsLogsPage from './features/logs/page/AnalyticsLogsPage';
import StoragePage from './features/storage/page/StoragePage';
import MetadataPage from './features/metadata/page/MetadataPage';
import OnBoardPage from './features/onboard/page/OnBoardPage';
import Layout from './components/layout/Layout';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      gcTime: 10 * 60 * 1000, // 10 minutes
      refetchOnWindowFocus: false,
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthErrorBoundary>
        <AuthProvider>
          <ToastProvider>
            <AppRoutes />
          </ToastProvider>
        </AuthProvider>
      </AuthErrorBoundary>
    </QueryClientProvider>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/dashboard/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={
          <PrivateRoute>
            <Layout>
              <Routes>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/dashboard/authentication" element={<AuthenticationPage />} />
                <Route path="/dashboard/database" element={<DatabasePage />} />
                <Route path="/dashboard/storage" element={<StoragePage />} />
                <Route path="/dashboard/logs" element={<LogsPage />} />
                <Route path="/dashboard/analytics" element={<AnalyticsLogsPage />} />
                <Route path="/dashboard/metadata" element={<MetadataPage />} />
                <Route path="/onboard" element={<OnBoardPage />} />
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Routes>
            </Layout>
          </PrivateRoute>
        }
      />
    </Routes>
  );
}

export default App;
