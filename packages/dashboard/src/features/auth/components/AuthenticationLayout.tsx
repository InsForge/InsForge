import { DashboardSectionLayout } from '../../../layout/DashboardSectionLayout';
import { Outlet } from 'react-router-dom';
import { AuthenticationSidebar } from './AuthenticationSidebar';

export default function AuthenticationLayout() {
  return (
    <DashboardSectionLayout sidebar={<AuthenticationSidebar />}>
      <div className="h-full min-h-0 overflow-hidden">
        <Outlet />
      </div>
    </DashboardSectionLayout>
  );
}
