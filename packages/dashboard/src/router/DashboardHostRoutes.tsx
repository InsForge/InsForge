import type { ReactNode } from 'react';
import { Route, Routes } from 'react-router-dom';

export interface DashboardHostRoutesProps {
  loginPage: ReactNode;
  protectedApp: ReactNode;
}

export function DashboardHostRoutes({ loginPage, protectedApp }: DashboardHostRoutesProps) {
  return (
    <Routes>
      <Route path="/dashboard/login" element={loginPage} />
      <Route path="/*" element={protectedApp} />
    </Routes>
  );
}
