import { Navigate } from 'react-router-dom';
import { Skeleton } from '../../../components';
import { useMcpUsage } from '../../logs/hooks/useMcpUsage';
import { DTestConnectedDashboard } from '../components/dtest/DTestConnectedDashboard';

function DTestLoadingState() {
  return (
    <main className="h-full min-h-0 min-w-0 overflow-y-auto bg-semantic-1">
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-6 px-6 pt-16">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-[140px] w-full rounded" />
        <Skeleton className="h-[260px] w-full rounded" />
        <Skeleton className="h-[120px] w-full rounded" />
      </div>
    </main>
  );
}

export default function DTestDashboardPage() {
  const { hasCompletedOnboarding, isLoading } = useMcpUsage();

  if (isLoading) {
    return <DTestLoadingState />;
  }

  if (!hasCompletedOnboarding) {
    return <Navigate to="/dashboard/install" replace />;
  }

  return <DTestConnectedDashboard />;
}
