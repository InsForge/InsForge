import { Skeleton } from '../../../components';
import { useMcpUsage } from '../../logs/hooks/useMcpUsage';
import { useProjectId } from '../../../lib/hooks/useMetadata';
import { useDTestView } from '../components/dtest/useDTestView';
import { InstallInsForgePage } from '../components/dtest/InstallInsForgePage';
import { ClientDetailPage } from '../components/dtest/ClientDetailPage';
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
  const { hasCompletedOnboarding, isLoading: isMcpUsageLoading } = useMcpUsage();
  const { projectId } = useProjectId();

  const { view, setView, selectedClient, setSelectedClient } = useDTestView({
    hasCompletedOnboarding,
    projectId,
  });

  if (isMcpUsageLoading) {
    return <DTestLoadingState />;
  }

  if (view === 'install') {
    if (selectedClient !== null) {
      return <ClientDetailPage clientId={selectedClient} onBack={() => setSelectedClient(null)} />;
    }
    return (
      <InstallInsForgePage
        onSelectClient={(id) => setSelectedClient(id)}
        onDismiss={() => setView('dashboard', { dismiss: true })}
      />
    );
  }

  return <DTestConnectedDashboard />;
}
