import { type ReactNode, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@insforge/ui';
import { Braces, Database, Download, HardDrive, User } from 'lucide-react';
import { MetricCard } from '#features/dashboard/components/MetricCard';
import { useMetadata } from '#lib/hooks/useMetadata';
import { useCloudProjectInfo } from '#lib/hooks/useCloudProjectInfo';
import { useUsers } from '#features/auth';
import { isInsForgeCloudProject } from '#lib/utils/utils';
import { useMcpUsage } from '#features/logs/hooks/useMcpUsage';
import { useAdvisorLatest } from '#features/dashboard/hooks/useAdvisor';
import { useLastBackup } from '#features/dashboard/hooks/useLastBackup';
import { useDashboardProject, useIsCloudHostingMode } from '#lib/config/DashboardHostContext';
import CloudDoneIcon from '#assets/icons/cloud_done.svg?react';
import CriticalIcon from '#assets/icons/severity_critical.svg?react';
import { DashboardPromptStepper } from './DashboardPromptStepper';
import { ObservabilitySection } from '#features/dashboard/components/observability';
import { BackendAdvisorSection } from '#features/dashboard/components/advisor';

function formatBackupAge(iso: string | undefined, t: TFunction): string | null {
  if (!iso) {
    return null;
  }
  const timestamp = new Date(iso).getTime();
  if (Number.isNaN(timestamp)) {
    return null;
  }
  const minutes = Math.floor((Date.now() - timestamp) / 60_000);
  if (minutes < 1) {
    return t('overview.justNow', { defaultValue: 'just now' });
  }
  if (minutes < 60) {
    return t('overview.minsAgo', {
      count: minutes,
      defaultValue: `${minutes}min${minutes === 1 ? '' : 's'} ago`,
    });
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return t('overview.hrsAgo', {
      count: hours,
      defaultValue: `${hours}hr${hours === 1 ? '' : 's'} ago`,
    });
  }
  const days = Math.floor(hours / 24);
  return t('overview.daysAgoShort', { count: days, defaultValue: '{{count}}d ago' });
}

const STATUS_BADGE_CLASS =
  'flex items-center gap-1 rounded-full bg-toast px-2 py-1 text-xs font-medium leading-4 text-foreground';

export function DTestConnectedDashboard() {
  const { t } = useTranslation('chrome');
  const navigate = useNavigate();
  const isCloudProject = isInsForgeCloudProject();
  const isCloudHostingMode = useIsCloudHostingMode();
  const {
    metadata,
    tables,
    storage,
    isLoading: isMetadataLoading,
    error: metadataError,
  } = useMetadata();
  const { projectInfo } = useCloudProjectInfo();
  const project = useDashboardProject();
  const { totalUsers } = useUsers();
  const { hasCompletedOnboarding } = useMcpUsage();
  const isBranch = project?.isBranch === true;
  const lastBackupQuery = useLastBackup();
  const advisorLatest = useAdvisorLatest();
  const advisorRef = useRef<HTMLDivElement>(null);

  const scrollToAdvisor = () => {
    advisorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // The advisor section only mounts in cloud-hosting mode, so only make these
  // badges clickable when there is somewhere for them to scroll to.
  const renderAdvisorBadge = (content: ReactNode, label: string) =>
    isCloudHostingMode ? (
      <button
        type="button"
        onClick={scrollToAdvisor}
        className={`${STATUS_BADGE_CLASS} transition-colors hover:bg-[var(--alpha-8)]`}
        aria-label={label}
      >
        {content}
      </button>
    ) : (
      <div className={STATUS_BADGE_CLASS}>{content}</div>
    );

  const projectName = isCloudProject
    ? projectInfo.name || t('overview.myProject', { defaultValue: 'My InsForge Project' })
    : t('overview.myProject', { defaultValue: 'My InsForge Project' });
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
  const lastBackupAge = formatBackupAge(lastBackupQuery.data?.createdAt, t);
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
            {renderAdvisorBadge(
              <>
                <span className="flex h-5 w-5 items-center justify-center">
                  <span
                    className={`h-2 w-2 rounded-full ${isHealthy ? 'bg-emerald-400' : 'bg-amber-400'}`}
                  />
                </span>
                <span className="px-1">
                  {projectHealth === 'Healthy'
                    ? t('overview.healthy', { defaultValue: 'Healthy' })
                    : projectHealth === 'Issue'
                      ? t('overview.issue', { defaultValue: 'Issue' })
                      : t('overview.loading', { defaultValue: 'Loading...' })}
                </span>
              </>,
              t('overview.viewBackendAdvisor', { defaultValue: 'View backend advisor' })
            )}
            {lastBackupAge && (
              <button
                type="button"
                onClick={() => void navigate('/dashboard/database/backups')}
                className={`${STATUS_BADGE_CLASS} transition-colors hover:bg-[var(--alpha-8)]`}
                aria-label={t('overview.viewBackupRestore', {
                  defaultValue: 'View backup & restore',
                })}
              >
                <CloudDoneIcon className="h-5 w-5 text-primary" />
                <span className="px-1">
                  {t('overview.lastBackup', {
                    age: lastBackupAge,
                    defaultValue: 'Last Backup {{age}}',
                  })}
                </span>
              </button>
            )}
            {criticalCount > 0 &&
              renderAdvisorBadge(
                <>
                  <CriticalIcon className="h-5 w-5 text-destructive" />
                  <span className="px-1">
                    {t('overview.criticalIssues', {
                      count: criticalCount,
                      defaultValue:
                        criticalCount === 1
                          ? '{{count}} Critical Issue'
                          : '{{count}} Critical Issues',
                    })}
                  </span>
                </>,
                t('overview.viewCriticalIssues', {
                  defaultValue: 'View critical issues in backend advisor',
                })
              )}
          </div>
        </div>

        {!hasCompletedOnboarding && !isBranch && (
          <section className="flex w-full flex-col items-center gap-6 rounded-lg border border-[var(--alpha-8)] bg-card px-6 pb-12 pt-10">
            <p className="text-xl font-medium leading-7 text-foreground">
              {t('overview.letAgentBuild', {
                defaultValue: 'Let your agent build your backend for you',
              })}
            </p>
            <button
              type="button"
              onClick={() => void navigate('/dashboard/install')}
              className="flex items-center gap-1 rounded bg-emerald-300 p-2 text-sm font-medium leading-5 text-black transition-colors hover:bg-emerald-400"
            >
              <Download className="h-5 w-5" aria-hidden="true" />
              <span className="px-1">
                {t('overview.installInsForge', { defaultValue: 'Install InsForge' })}
              </span>
            </button>
          </section>
        )}

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <MetricCard
            label={t('overview.user', { defaultValue: 'User' })}
            value={String(totalUsers ?? 0)}
            icon={<User className="h-5 w-5" />}
            onNavigate={() => void navigate('/dashboard/authentication/users')}
          />
          <MetricCard
            label={t('overview.database', { defaultValue: 'Database' })}
            value={`${tableCount}`}
            subValueLeft={t('overview.tablesUnit', {
              count: tableCount,
              defaultValue: tableCount === 1 ? 'Table' : 'Tables',
            })}
            subValueRight={`${databaseSize} GB`}
            icon={<Database className="h-5 w-5" />}
            onNavigate={() => void navigate('/dashboard/database/tables')}
          />
          <MetricCard
            label={t('overview.storage', { defaultValue: 'Storage' })}
            value={`${bucketCount}`}
            subValueLeft={t('overview.bucketsUnit', {
              count: bucketCount,
              defaultValue: bucketCount === 1 ? 'Bucket' : 'Buckets',
            })}
            subValueRight={`${storageSize} GB`}
            icon={<HardDrive className="h-5 w-5" />}
            onNavigate={() => void navigate('/dashboard/storage')}
          />
          <MetricCard
            label={t('overview.edgeFunctions', { defaultValue: 'Edge Functions' })}
            value={String(functionCount)}
            subValueLeft={t('overview.functionsUnit', {
              count: functionCount,
              defaultValue: functionCount === 1 ? 'Function' : 'Functions',
            })}
            icon={<Braces className="h-5 w-5" />}
            onNavigate={() => void navigate('/dashboard/functions/list')}
          />
        </div>

        <DashboardPromptStepper />
        {isCloudHostingMode && (
          <>
            <ObservabilitySection />
            <div ref={advisorRef} className="scroll-mt-10">
              <BackendAdvisorSection />
            </div>
          </>
        )}
      </div>
    </main>
  );
}
