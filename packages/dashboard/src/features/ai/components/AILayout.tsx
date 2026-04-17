import { Outlet } from 'react-router-dom';
import { AISidebar } from './AISidebar';

export default function AILayout() {
  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-[rgb(var(--semantic-1))]">
      <AISidebar />
      <div className="min-w-0 flex-1 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
