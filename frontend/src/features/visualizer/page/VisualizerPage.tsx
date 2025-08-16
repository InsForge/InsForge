import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useCallback } from 'react';
import { metadataService } from '@/features/metadata/services/metadata.service';
import { SchemaVisualizer, VisualizerSkeleton } from '../components';
import { Button } from '@/components/radix/Button';
import { Alert, AlertDescription } from '@/components/radix/Alert';

const VisualizerPage = () => {
  const {
    data: metadata,
    isLoading,
    error,
    refetch: refetchMetadata,
  } = useQuery({
    queryKey: ['database-metadata-visualizer'],
    queryFn: () => metadataService.getDatabaseMetadata(),
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
  });

  const handleRefresh = useCallback(() => {
    void refetchMetadata();
  }, [refetchMetadata]);

  if (isLoading) {
    return <VisualizerSkeleton />;
  }

  if (error) {
    return (
      <div className="relative min-h-screen bg-neutral-800 overflow-hidden">
        {/* Dot Matrix Background */}
        <div
          className="absolute inset-0 opacity-50"
          style={{
            backgroundImage: `radial-gradient(circle, #3B3B3B 1px, transparent 1px)`,
            backgroundSize: '12px 12px',
          }}
        />

        <div className="relative z-10 flex items-center justify-center min-h-screen p-8">
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

  if (!metadata || metadata.tables.length === 0) {
    return (
      <div className="relative min-h-screen bg-neutral-800 overflow-hidden">
        {/* Dot Matrix Background */}
        <div
          className="absolute inset-0 opacity-50"
          style={{
            backgroundImage: `radial-gradient(circle, #3B3B3B 1px, transparent 1px)`,
            backgroundSize: '12px 12px',
          }}
        />

        <div className="relative z-10 flex items-center justify-center min-h-screen p-8">
          <div className="text-center">
            <h2 className="text-2xl font-semibold text-white mb-4">No Tables Found</h2>
            <p className="text-gray-400 mb-6">
              The database schema is empty. Create some tables to visualize them here.
            </p>
            <Button
              onClick={handleRefresh}
              variant="outline"
              className="bg-white/10 text-white border-white/20 hover:bg-white/20"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-neutral-800 overflow-hidden">
      {/* Dot Matrix Background */}
      <div
        className="absolute inset-0 opacity-50"
        style={{
          backgroundImage: `radial-gradient(circle, #3B3B3B 1px, transparent 1px)`,
          backgroundSize: '12px 12px',
        }}
      />

      {/* Schema Visualizer */}
      <div className="relative z-10 w-full h-screen">
        <SchemaVisualizer metadata={metadata} />
      </div>
    </div>
  );
};

export default VisualizerPage;
