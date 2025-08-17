import { useQuery } from '@tanstack/react-query';
import { metadataService } from '@/features/dashboard/services/metadata.service';
import { authService } from '@/features/auth/services/auth.service';
import { Card, CardContent } from '@/components/radix/Card';
import { Skeleton } from '@/components/radix/Skeleton';
import { McpInstallation } from '@/components/mcp';

export default function DashboardPage() {
  const {
    data: metadata,
    isLoading,
    refetch: _refetchMetadata,
  } = useQuery({
    queryKey: ['metadata'],
    queryFn: () => metadataService.getAppMetadata(),
  });

  const { data: apiKey } = useQuery({
    queryKey: ['apiKey'],
    queryFn: () => metadataService.fetchApiKey(),
    staleTime: Infinity,
  });

  const { data: usersData } = useQuery({
    queryKey: ['users-count'],
    queryFn: () => authService.getUsers(),
    enabled: !!apiKey,
  });

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  return (
    <main className="h-full bg-bg-gray dark:bg-neutral-800">
      {/* Main Content - Centered with max width */}
      <div className="px-8 py-8 flex justify-center">
        <div className="w-full max-w-[1032px]">
          <p className="text-2xl font-bold text-black dark:text-white mb-6 text-left w-full">
            Dashboard
          </p>
          {/* Stats Cards */}
          <div className="grid gap-6 md:grid-cols-3 mb-10">
            <Card className="bg-white dark:bg-neutral-700 border border-gray-200 dark:border-none rounded-lg">
              <CardContent className="p-6">
                <div className="flex justify-between items-start mb-4">
                  <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                    AUTH
                  </h3>
                </div>
                <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">
                  {usersData?.records?.length || 0}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">User</p>
              </CardContent>
            </Card>

            <Card className="bg-white dark:bg-neutral-700 border border-gray-200 dark:border-none rounded-lg">
              <CardContent className="p-6">
                <div className="flex justify-between items-start mb-4">
                  <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                    Database
                  </h3>
                </div>
                <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">
                  {(metadata?.database_size_gb || 0).toFixed(2)}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">GB</p>
              </CardContent>
            </Card>

            <Card className="bg-white dark:bg-neutral-700 border border-gray-200 dark:border-none rounded-lg">
              <CardContent className="p-6">
                <div className="flex justify-between items-start mb-4">
                  <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                    Storage
                  </h3>
                </div>
                <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">
                  {(metadata?.storage_size_gb || 0).toFixed(2)}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">GB</p>
              </CardContent>
            </Card>
          </div>

          {/* MCP Configuration Section */}
          <McpInstallation />
        </div>
      </div>
    </main>
  );
}

function DashboardSkeleton() {
  return (
    <main className="min-h-screen bg-bg-gray dark:bg-gray-900">
      <div className="sticky top-0 z-30 bg-bg-gray dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
        <div className="px-8 pt-6 pb-4">
          <Skeleton className="h-8 w-32" />
        </div>
      </div>
      <div className="p-6 flex justify-center">
        <div className="w-full max-w-[1032px]">
          <div className="grid gap-6 md:grid-cols-3 mb-10">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
          <Skeleton className="h-96" />
        </div>
      </div>
    </main>
  );
}
