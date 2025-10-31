import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { RequireAuth } from '@/lib/routing/RequireAuth';
import Layout from '@/components/layout/Layout';
import CloudLayout from '@/components/layout/CloudLayout';
import LoginPage from '@/features/login/page/LoginPage';
import CloudLoginPage from '@/features/login/page/CloudLoginPage';
import DashboardPage from '@/features/dashboard/page/DashboardPage';
import DatabasePage from '@/features/database/page/DatabasePage';
import AuthenticationPage from '@/features/auth/page/AuthenticationPage';
import AuditsPage from '@/features/logs/page/AuditsPage';
import LogsPage from '@/features/logs/page/LogsPage';
import StoragePage from '@/features/storage/page/StoragePage';
import MetadataPage from '@/features/metadata/page/MetadataPage';
import OnBoardPage from '@/features/onboard/page/OnBoardPage';
import VisualizerPage from '@/features/visualizer/page/VisualizerPage';
import FunctionsPage from '@/features/functions/page/FunctionsPage';
import AIPage from '@/features/ai/page/AIPage';
import SignInPage from '@/features/auth/page/SignInPage';
import SignUpPage from '@/features/auth/page/SignUpPage';
import VerifyEmailPage from '@/features/auth/page/VerifyEmailPage';
import ForgotPasswordPage from '@/features/auth/page/ForgotPasswordPage';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/dashboard/login" element={<LoginPage />} />
      <Route path="/cloud/login" element={<CloudLoginPage />} />
      <Route path="/auth" element={<Outlet />}>
        <Route index element={<Navigate to="signin" replace />} />
        <Route path="signin" element={<SignInPage />} />
        <Route path="signup" element={<SignUpPage />} />
        <Route path="verify-email" element={<VerifyEmailPage />} />
        <Route path="forgot-password" element={<ForgotPasswordPage />} />
        <Route path="*" element={<Navigate to="signin" replace />} />
      </Route>
      <Route
        path="/cloud/*"
        element={
          <RequireAuth>
            <CloudLayout>
              <Routes>
                <Route path="/" element={<Navigate to="/cloud/dashboard" replace />} />
                <Route path="/visualizer" element={<VisualizerPage />} />
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/authentication" element={<AuthenticationPage />} />
                <Route path="/database" element={<DatabasePage />} />
                <Route path="/storage" element={<StoragePage />} />
                <Route path="/logs" element={<LogsPage />} />
                <Route path="/functions" element={<FunctionsPage />} />
                <Route path="/ai" element={<AIPage />} />
                <Route path="/onboard" element={<OnBoardPage />} />
                <Route path="*" element={<Navigate to="/cloud/dashboard" replace />} />
              </Routes>
            </CloudLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <Layout>
              <Routes>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/dashboard/authentication" element={<AuthenticationPage />} />
                <Route path="/dashboard/database" element={<DatabasePage />} />
                <Route path="/dashboard/storage" element={<StoragePage />} />
                <Route path="/dashboard/audits" element={<AuditsPage />} />
                <Route path="/dashboard/logs" element={<LogsPage />} />
                <Route path="/dashboard/functions" element={<FunctionsPage />} />
                <Route path="/dashboard/metadata" element={<MetadataPage />} />
                <Route path="/dashboard/onboard" element={<OnBoardPage />} />
                <Route path="/dashboard/ai" element={<AIPage />} />
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Routes>
            </Layout>
          </RequireAuth>
        }
      />
    </Routes>
  );
}
