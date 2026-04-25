import { Skeleton } from '../../../components';
import { useDTestView } from '../components/dtest/DTestViewContext';
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
  const { view, setView, selectedClient, setSelectedClient, isLoading } = useDTestView();

  if (isLoading) {
    return <DTestLoadingState />;
  }

  if (view === 'install') {
    if (selectedClient !== null) {
      return <ClientDetailPage clientId={selectedClient} onBack={() => setSelectedClient(null)} />;
    }
    return (
      <InstallInsForgePage
        onSelectClient={(id) => setSelectedClient(id)}
        onDismiss={() => setView('dashboard')}
      />
    );
  }

  return <DTestConnectedDashboard />;
}
