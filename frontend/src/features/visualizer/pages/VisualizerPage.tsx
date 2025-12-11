import { RefreshCw } from 'lucide-react';
import { useCallback } from 'react';
import { useMetadata } from '@/lib/hooks/useMetadata';
import { useUsers } from '@/features/auth/hooks/useUsers';
import { SchemaVisualizer, VisualizerSkeleton } from '../components';
import { Alert, AlertDescription, Button } from '@/components';

const VisualizerPage = () => {
  const {
    metadata,
    isLoading: metadataLoading,
    error: metadataError,
    refetch: refetchMetadata,
  } = useMetadata();

  const {
    totalUsers,
    isLoading: userStatsLoading,
    refetch: refetchUserStats,
  } = useUsers({ enabled: true });

  const isLoading = metadataLoading || userStatsLoading;
  const error = metadataError;

  const handleRefresh = useCallback(() => {
    void refetchMetadata();
    void refetchUserStats();
  }, [refetchMetadata, refetchUserStats]);

  if (isLoading) {
    return <VisualizerSkeleton />;
  }

  if (!metadata || error) {
    return (
      <div className="relative h-full bg-gray-50 dark:bg-neutral-800 overflow-hidden">
        {/* Dot Matrix Background - Light Mode */}
        <div
          className="absolute inset-0 opacity-50 dark:hidden"
          style={{
            backgroundImage: `radial-gradient(circle, #D1D5DB 1px, transparent 1px)`,
            backgroundSize: '12px 12px',
          }}
        />
        {/* Dot Matrix Background - Dark Mode */}
        <div
          className="absolute inset-0 opacity-50 hidden dark:block"
          style={{
            backgroundImage: `radial-gradient(circle, #3B3B3B 1px, transparent 1px)`,
            backgroundSize: '12px 12px',
          }}
        />

        <div className="relative z-10 flex items-center justify-center h-full p-8">
          <Alert variant="destructive" className="max-w-md">
            <AlertDescription>
              Failed to load database schema. Please ensure the backend is running and try
              refreshing.
            </AlertDescription>
            <Button onClick={handleRefresh} className="mt-4 w-full" variant="outline">
              <RefreshCw className="w-4 h-4 mr-2" />
              Retry
            </Button>
          </Alert>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full bg-gray-50 dark:bg-neutral-800 overflow-hidden">
      {/* Dot Matrix Background - Light Mode */}
      <div
        className="absolute inset-0 opacity-50 dark:hidden"
        style={{
          backgroundImage: `radial-gradient(circle, #D1D5DB 1px, transparent 1px)`,
          backgroundSize: '12px 12px',
        }}
      />
      {/* Dot Matrix Background - Dark Mode */}
      <div
        className="absolute inset-0 opacity-50 hidden dark:block"
        style={{
          backgroundImage: `radial-gradient(circle, #3B3B3B 1px, transparent 1px)`,
          backgroundSize: '12px 12px',
        }}
      />

      {/* Schema Visualizer */}
      <div className="relative z-10 w-full h-full">
        <SchemaVisualizer metadata={metadata} userCount={totalUsers} />
      </div>
    </div>
  );
};

export default VisualizerPage;
