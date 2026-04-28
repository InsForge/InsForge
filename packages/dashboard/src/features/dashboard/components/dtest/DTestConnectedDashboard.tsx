import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@insforge/ui';
import { Braces, Database, Download, HardDrive, User } from 'lucide-react';
import { MetricCard } from '../MetricCard';
import { useMetadata } from '../../../../lib/hooks/useMetadata';
import { useCloudProjectInfo } from '../../../../lib/hooks/useCloudProjectInfo';
import { useUsers } from '../../../auth';
import { isInsForgeCloudProject } from '../../../../lib/utils/utils';
import { useMcpUsage } from '../../../logs/hooks/useMcpUsage';
import { DashboardPromptStepper } from './DashboardPromptStepper';

export function DTestConnectedDashboard() {
  const navigate = useNavigate();
  const isCloudProject = isInsForgeCloudProject();
  const {
    metadata,
    tables,
    storage,
    isLoading: isMetadataLoading,
    error: metadataError,
  } = useMetadata();
  const { projectInfo } = useCloudProjectInfo();
  const { totalUsers } = useUsers();
  const { hasCompletedOnboarding } = useMcpUsage();

  const projectName = isCloudProject
    ? projectInfo.name || 'My InsForge Project'
    : 'My InsForge Project';
  const instanceType = projectInfo.instanceType?.toUpperCase();
  const showInstanceTypeBadge = isCloudProject && !!instanceType;

  const projectHealth = useMemo(() => {
    if (metadataError) {
      return 'Issue';
    }
    if (isMetadataLoading) {
      return 'Loading...';
    }
    return 'Healthy';
  }, [isMetadataLoading, metadataError]);

  const isHealthy = projectHealth === 'Healthy';

  const tableCount = tables?.length ?? 0;
  const databaseSize = (metadata?.database.totalSizeInGB ?? 0).toFixed(2);
  const storageSize = (storage?.totalSizeInGB ?? 0).toFixed(2);
  const bucketCount = storage?.buckets?.length ?? 0;
  const functionCount = metadata?.functions.length ?? 0;

  return (
    <main className="h-full min-h-0 min-w-0 overflow-y-auto bg-semantic-0">
      <div className="flex w-full flex-col gap-12 px-10 py-8">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-normal leading-8 text-foreground">{projectName}</h1>
          {showInstanceTypeBadge && (
            <Badge
              variant="default"
              className="rounded bg-[var(--alpha-8)] px-1 py-0.5 text-xs font-medium uppercase text-muted-foreground"
            >
              {instanceType}
            </Badge>
          )}
          <div className="flex items-center rounded-full bg-toast px-2 py-1">
            <div
              className={`mr-1.5 h-2 w-2 rounded-full ${isHealthy ? 'bg-emerald-400' : 'bg-amber-400'}`}
            />
            <span className="text-xs font-medium text-foreground">{projectHealth}</span>
          </div>
        </div>

        {!hasCompletedOnboarding && (
          <section className="flex w-full flex-col items-center gap-6 rounded-lg border border-[var(--alpha-8)] bg-card px-6 pb-12 pt-10">
            <p className="text-xl font-medium leading-7 text-foreground">
              Let your agent build your backend for you
            </p>
            <button
              type="button"
              onClick={() => void navigate('/dashboard/install')}
              className="flex items-center gap-1 rounded bg-emerald-300 p-2 text-sm font-medium leading-5 text-black transition-colors hover:bg-emerald-400"
            >
              <Download className="h-5 w-5" aria-hidden="true" />
              <span className="px-1">Install InsForge</span>
            </button>
          </section>
        )}

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <MetricCard
            label="User"
            value={String(totalUsers ?? 0)}
            icon={<User className="h-5 w-5" />}
            onNavigate={() => void navigate('/dashboard/authentication/users')}
          />
          <MetricCard
            label="Database"
            value={`${tableCount}`}
            subValueLeft={tableCount === 1 ? 'Table' : 'Tables'}
            subValueRight={`${databaseSize} GB`}
            icon={<Database className="h-5 w-5" />}
            onNavigate={() => void navigate('/dashboard/database/tables')}
          />
          <MetricCard
            label="Storage"
            value={`${bucketCount}`}
            subValueLeft={bucketCount === 1 ? 'Bucket' : 'Buckets'}
            subValueRight={`${storageSize} GB`}
            icon={<HardDrive className="h-5 w-5" />}
            onNavigate={() => void navigate('/dashboard/storage')}
          />
          <MetricCard
            label="Edge Functions"
            value={String(functionCount)}
            subValueLeft={functionCount === 1 ? 'Function' : 'Functions'}
            icon={<Braces className="h-5 w-5" />}
            onNavigate={() => void navigate('/dashboard/functions/list')}
          />
        </div>

        <DashboardPromptStepper />
      </div>
    </main>
  );
}
