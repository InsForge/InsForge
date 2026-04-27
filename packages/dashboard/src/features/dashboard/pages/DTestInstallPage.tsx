import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Skeleton } from '../../../components';
import { useMcpUsage } from '../../logs/hooks/useMcpUsage';
import { ClientDetailPage } from '../components/dtest/ClientDetailPage';
import { InstallInsForgePage } from '../components/dtest/InstallInsForgePage';
import type { ClientId } from '../components/dtest/clientRegistry';

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

export default function DTestInstallPage() {
  const navigate = useNavigate();
  const { hasCompletedOnboarding, isLoading } = useMcpUsage();
  const [selectedClient, setSelectedClient] = useState<ClientId | null>(null);

  // Auto-jump back to dashboard once onboarding flips false → true (e.g. an
  // MCP call lands while the user is mid-install).
  const prevOnboarding = useRef(hasCompletedOnboarding);
  useEffect(() => {
    if (isLoading) {
      return;
    }
    if (!prevOnboarding.current && hasCompletedOnboarding) {
      void navigate('/dashboard', { replace: true });
    }
    prevOnboarding.current = hasCompletedOnboarding;
  }, [hasCompletedOnboarding, isLoading, navigate]);

  if (isLoading) {
    return <DTestLoadingState />;
  }

  if (selectedClient !== null) {
    return <ClientDetailPage clientId={selectedClient} onBack={() => setSelectedClient(null)} />;
  }

  return (
    <InstallInsForgePage
      onSelectClient={(id) => setSelectedClient(id)}
      onDismiss={() => void navigate('/dashboard')}
    />
  );
}
