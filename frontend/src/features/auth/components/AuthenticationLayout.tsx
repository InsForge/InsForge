import { Outlet } from 'react-router-dom';
import { AuthenticationSidebar } from './AuthenticationSidebar';

export default function AuthenticationLayout() {
  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-[rgb(var(--semantic-1))]">
      <AuthenticationSidebar />
      <div className="min-w-0 flex-1 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
