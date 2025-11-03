import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { SignInPage } from './pages/SignInPage';
import { SignUpPage } from './pages/SignUpPage';
import { VerifyEmailPage } from './pages/VerifyEmailPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';

export enum AuthRouterPath {
  SIGN_IN = '/auth/sign-in',
  SIGN_UP = '/auth/sign-up',
  VERIFY_EMAIL = '/auth/verify-email',
  FORGOT_PASSWORD = '/auth/forgot-password',
  RESET_PASSWORD = '/auth/reset-password',
}

// Helper component to preserve search params and hash during redirect
function RedirectWithParams({ to }: { to: string }) {
  const location = useLocation();
  return <Navigate to={`${to}${location.search}${location.hash}`} replace />;
}

export function App() {
  return (
    <Routes>
      {/* Main routes */}
      <Route path={AuthRouterPath.SIGN_IN} element={<SignInPage />} />
      <Route path={AuthRouterPath.SIGN_UP} element={<SignUpPage />} />
      <Route path={AuthRouterPath.VERIFY_EMAIL} element={<VerifyEmailPage />} />
      <Route path={AuthRouterPath.FORGOT_PASSWORD} element={<ForgotPasswordPage />} />
      <Route path={AuthRouterPath.RESET_PASSWORD} element={<ResetPasswordPage />} />
      
      {/* Redirect routes without /auth prefix - preserves query params and hash */}
      <Route path="/sign-in" element={<RedirectWithParams to={AuthRouterPath.SIGN_IN} />} />
      <Route path="/sign-up" element={<RedirectWithParams to={AuthRouterPath.SIGN_UP} />} />
      <Route path="/verify-email" element={<RedirectWithParams to={AuthRouterPath.VERIFY_EMAIL} />} />
      <Route path="/forgot-password" element={<RedirectWithParams to={AuthRouterPath.FORGOT_PASSWORD} />} />
      <Route path="/reset-password" element={<RedirectWithParams to={AuthRouterPath.RESET_PASSWORD} />} />
    </Routes>
  );
}

export default App;
