import { Routes, Route } from 'react-router-dom';
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

export function App() {
  return (
    <Routes>
      {/* Main routes */}
      <Route path={AuthRouterPath.SIGN_IN} element={<SignInPage />} />
      <Route path={AuthRouterPath.SIGN_UP} element={<SignUpPage />} />
      <Route path={AuthRouterPath.VERIFY_EMAIL} element={<VerifyEmailPage />} />
      <Route path={AuthRouterPath.FORGOT_PASSWORD} element={<ForgotPasswordPage />} />
      <Route path={AuthRouterPath.RESET_PASSWORD} element={<ResetPasswordPage />} />
    </Routes>
  );
}

export default App;
