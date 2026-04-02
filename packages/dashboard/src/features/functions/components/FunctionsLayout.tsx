import { Outlet } from 'react-router-dom';
import { FunctionsSidebar } from './FunctionsSidebar';

export default function FunctionsLayout() {
  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-[rgb(var(--semantic-1))]">
      <FunctionsSidebar />
      <div className="min-w-0 flex-1 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
