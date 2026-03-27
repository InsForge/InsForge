import type { ReactNode } from 'react';
import { Route, Routes } from 'react-router-dom';

export interface DashboardHostRoutesProps {
  loginPage: ReactNode;
  cloudLoginPage?: ReactNode;
  protectedApp: ReactNode;
}

export function DashboardHostRoutes({
  loginPage,
  cloudLoginPage,
  protectedApp,
}: DashboardHostRoutesProps) {
  return (
    <Routes>
      <Route path="/dashboard/login" element={loginPage} />
      {cloudLoginPage ? <Route path="/cloud/login" element={cloudLoginPage} /> : null}
      <Route path="/*" element={protectedApp} />
    </Routes>
  );
}
