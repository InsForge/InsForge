import { Outlet } from 'react-router-dom';
import { RealtimeSidebar } from './RealtimeSidebar';

export default function RealtimeLayout() {
  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-[rgb(var(--semantic-1))]">
      <RealtimeSidebar />
      <div className="min-w-0 flex-1 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
