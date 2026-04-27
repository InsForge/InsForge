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
import { useAdvisorLatest } from '../../hooks/useAdvisor';
import { useLastBackup } from '../../hooks/useLastBackup';
import { CriticalIcon } from '../advisor/severityIcons';
import { DashboardPromptStepper } from './DashboardPromptStepper';
import { ObservabilitySection } from '../observability';
import { BackendAdvisorSection } from '../advisor';

function CloudDoneIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M8.625 13.8781L13.0448 9.45833L12.141 8.55458L8.61208 12.0833L6.84625 10.3173L5.95521 11.2083L8.625 13.8781ZM5.41667 16.25C4.265 16.25 3.28264 15.8499 2.46958 15.0496C1.65653 14.2494 1.25 13.2735 1.25 12.1219C1.25 11.1026 1.57639 10.196 2.22917 9.40229C2.88194 8.6084 3.71472 8.13882 4.7275 7.99354C4.99458 6.74785 5.62097 5.72917 6.60667 4.9375C7.59222 4.14583 8.72333 3.75 10 3.75C11.5075 3.75 12.7872 4.2759 13.839 5.32771C14.8908 6.37951 15.4167 7.65917 15.4167 9.16667V9.58333H15.6731C16.5513 9.65167 17.2837 10.0048 17.8702 10.6427C18.4567 11.2805 18.75 12.0385 18.75 12.9167C18.75 13.8461 18.4268 14.634 17.7804 15.2804C17.134 15.9268 16.3461 16.25 15.4167 16.25H5.41667ZM5.41667 15H15.4167C16 15 16.4931 14.7986 16.8958 14.3958C17.2986 13.9931 17.5 13.5 17.5 12.9167C17.5 12.3333 17.2986 11.8403 16.8958 11.4375C16.4931 11.0347 16 10.8333 15.4167 10.8333H14.1667V9.16667C14.1667 8.01389 13.7604 7.03125 12.9479 6.21875C12.1354 5.40625 11.1528 5 10 5C8.84722 5 7.86458 5.40625 7.05208 6.21875C6.23958 7.03125 5.83333 8.01389 5.83333 9.16667H5.41667C4.61111 9.16667 3.92361 9.45139 3.35417 10.0208C2.78472 10.5903 2.5 11.2778 2.5 12.0833C2.5 12.8889 2.78472 13.5764 3.35417 14.1458C3.92361 14.7153 4.61111 15 5.41667 15Z" />
    </svg>
  );
}

function formatBackupAge(iso: string | undefined): string | null {
  if (!iso) {
    return null;
  }
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) {
    return null;
  }
  const minutes = Math.floor((Date.now() - t) / 60_000);
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes}min${minutes === 1 ? '' : 's'} ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}hr${hours === 1 ? '' : 's'} ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const STATUS_BADGE_CLASS =
  'flex items-center gap-1 rounded-full bg-toast px-2 py-1 text-xs font-medium leading-4 text-foreground';

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
  const lastBackupQuery = useLastBackup();
  const advisorLatest = useAdvisorLatest();

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
  const lastBackupAge = formatBackupAge(lastBackupQuery.data?.createdAt);
  const criticalCount = advisorLatest.data?.summary?.critical ?? 0;

  const tableCount = tables?.length ?? 0;
  const databaseSize = (metadata?.database.totalSizeInGB ?? 0).toFixed(2);
  const storageSize = (storage?.totalSizeInGB ?? 0).toFixed(2);
  const bucketCount = storage?.buckets?.length ?? 0;
  const functionCount = metadata?.functions.length ?? 0;

  return (
    <main className="h-full min-h-0 min-w-0 overflow-y-auto bg-semantic-0">
      <div className="mx-auto flex w-full max-w-[1024px] flex-col gap-12 px-10 py-10">
        <div className="flex flex-col gap-3">
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
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className={STATUS_BADGE_CLASS}>
              <span className="flex h-5 w-5 items-center justify-center">
                <span
                  className={`h-2 w-2 rounded-full ${isHealthy ? 'bg-emerald-400' : 'bg-amber-400'}`}
                />
              </span>
              <span className="px-1">{projectHealth}</span>
            </div>
            {lastBackupAge && (
              <div className={STATUS_BADGE_CLASS}>
                <CloudDoneIcon className="h-5 w-5 text-primary" />
                <span className="px-1">Last Backup {lastBackupAge}</span>
              </div>
            )}
            {criticalCount > 0 && (
              <div className={STATUS_BADGE_CLASS}>
                <CriticalIcon className="h-5 w-5 text-red-500" />
                <span className="px-1">
                  {criticalCount} Critical {criticalCount === 1 ? 'Issue' : 'Issues'}
                </span>
              </div>
            )}
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
        <ObservabilitySection />
        <BackendAdvisorSection />
      </div>
    </main>
  );
}
