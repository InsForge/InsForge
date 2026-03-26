import { Outlet } from 'react-router-dom';
import { LogsSidebar } from './LogsSidebar';

export default function LogsLayout() {
  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-[rgb(var(--semantic-1))]">
      <LogsSidebar />
      <div className="min-w-0 flex-1 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
