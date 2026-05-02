import { Outlet } from 'react-router-dom';
import { DeploymentsSidebar } from './DeploymentsSidebar';

export default function DeploymentsLayout() {
  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-[rgb(var(--semantic-1))]">
      <DeploymentsSidebar />
      <div className="min-w-0 flex-1 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
