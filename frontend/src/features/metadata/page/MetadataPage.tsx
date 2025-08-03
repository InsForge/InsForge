import { useQuery } from '@tanstack/react-query';
import { RefreshCw, Copy, Info } from 'lucide-react';
import { metadataService } from '../services/metadata.service';
import { Skeleton } from '@/components/radix/Skeleton';
import { Button } from '@/components/radix/Button';
import { Alert, AlertDescription } from '@/components/radix/Alert';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/radix/Tooltip';
import { JsonHighlight } from '@/components';
import { useToast } from '@/lib/hooks/useToast';

export default function MetadataPage() {
  const { showToast } = useToast();

  const {
    data: metadata,
    isLoading,
    error,
    refetch: refetchMetadata,
  } = useQuery({
    queryKey: ['full-metadata'],
    queryFn: () => metadataService.getFullMetadata(),
  });

  const handleRefresh = () => {
    void refetchMetadata();
  };

  const handleCopy = async () => {
    if (!metadata) {
      return;
    }

    try {
      await navigator.clipboard.writeText(JSON.stringify(metadata, null, 2));
      showToast('Metadata copied to clipboard!', 'success');
    } catch (err) {
      showToast('Failed to copy to clipboard', 'error');
    }
  };

  if (error) {
    return (
      <main className="min-h-screen bg-bg-gray">
        <div className="px-8 pt-6 pb-4">
          <div className="flex items-center">
            <nav className="flex items-center text-[22px] font-semibold">
              <span className="text-gray-900">Metadata</span>
            </nav>
          </div>
        </div>
        <div className="px-8 py-8">
          <Alert variant="destructive">
            <AlertDescription>
              Failed to load metadata. Please try refreshing the page.
            </AlertDescription>
          </Alert>
        </div>
      </main>
    );
  }

  if (isLoading) {
    return <MetadataSkeleton />;
  }

  return (
    <main className="min-h-screen bg-bg-gray">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-bg-gray border-b border-gray-200">
        <div className="px-8 pt-6 pb-4">
          <div className="flex items-center">
            <nav className="flex items-center text-[22px] font-semibold">
              <span className="text-gray-900">Metadata</span>
            </nav>

            {/* Separator */}
            <div className="mx-4 h-6 w-px bg-gray-200" />

            {/* Action buttons group */}
            <div className="flex items-center gap-1">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-9 w-9" onClick={handleRefresh}>
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Refresh Metadata</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
        </div>
      </div>

      <div className="px-8 py-8">
        {/* Metadata Section */}
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-semibold text-gray-900 mb-2">System Metadata</h2>
            <p className="text-gray-600">Complete metadata information for the InsForge system</p>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="flex items-center justify-between px-6 pt-4 bg-white">
              <div className="flex items-center gap-2">
                <Info className="h-5 w-5 text-gray-700" />
                <span className="font-medium text-gray-900">Raw JSON Data</span>
              </div>
            </div>

            <div className="px-4 pb-4 pt-4">
              {!metadata && (
                <Alert className="border-yellow-200 bg-yellow-50 mb-4">
                  <AlertDescription className="text-yellow-800">
                    No metadata available. Please ensure the backend is running and you're logged in
                    as an admin.
                  </AlertDescription>
                </Alert>
              )}

              {metadata && <JsonHighlight json={JSON.stringify(metadata, null, 2)} />}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function MetadataSkeleton() {
  return (
    <main className="min-h-screen bg-bg-gray">
      <div className="px-8 pt-6 pb-4">
        <div className="flex items-center">
          <nav className="flex items-center text-[22px] font-semibold">
            <span className="text-gray-900">Metadata</span>
          </nav>
        </div>
      </div>
      <div className="px-8 py-8">
        <div className="space-y-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-96" />
          <Skeleton className="h-100" />
        </div>
      </div>
    </main>
  );
}
