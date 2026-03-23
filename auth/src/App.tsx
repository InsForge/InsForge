import { Routes, Route, Navigate } from 'react-router-dom';
import { SignInPage } from './pages/SignInPage';
import { SignUpPage } from './pages/SignUpPage';
import { VerifyEmailPage } from './pages/VerifyEmailPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { DeviceAuthorizePage } from './pages/DeviceAuthorizePage';
import { DeviceConsentPage } from './pages/DeviceConsentPage';
import { Layout } from './components/Layout';
import {
  AUTH_DEVICE_AUTHORIZE_PATH,
  AUTH_DEVICE_CONSENT_PATH,
  AUTH_FORGOT_PASSWORD_PATH,
  AUTH_RESET_PASSWORD_PATH,
  AUTH_SIGN_IN_PATH,
  AUTH_SIGN_UP_PATH,
  AUTH_VERIFY_EMAIL_PATH,
} from './lib/deviceAuthorization';

export const AuthRouterPath = {
  SIGN_IN: AUTH_SIGN_IN_PATH,
  SIGN_UP: AUTH_SIGN_UP_PATH,
  VERIFY_EMAIL: AUTH_VERIFY_EMAIL_PATH,
  FORGOT_PASSWORD: AUTH_FORGOT_PASSWORD_PATH,
  RESET_PASSWORD: AUTH_RESET_PASSWORD_PATH,
  DEVICE_AUTHORIZE: AUTH_DEVICE_AUTHORIZE_PATH,
  DEVICE_CONSENT: AUTH_DEVICE_CONSENT_PATH,
} as const;

export function App() {
  return (
    <Layout>
      <Routes>
        {/* Main routes */}
        <Route path={AuthRouterPath.SIGN_IN} element={<SignInPage />} />
        <Route path={AuthRouterPath.SIGN_UP} element={<SignUpPage />} />
        <Route path={AuthRouterPath.VERIFY_EMAIL} element={<VerifyEmailPage />} />
        <Route path={AuthRouterPath.FORGOT_PASSWORD} element={<ForgotPasswordPage />} />
        <Route path={AuthRouterPath.RESET_PASSWORD} element={<ResetPasswordPage />} />
        <Route path={AuthRouterPath.DEVICE_AUTHORIZE} element={<DeviceAuthorizePage />} />
        <Route path={AuthRouterPath.DEVICE_CONSENT} element={<DeviceConsentPage />} />
        <Route path="*" element={<Navigate to={AuthRouterPath.SIGN_IN} replace />} />
      </Routes>
    </Layout>
  );
}

export default App;
