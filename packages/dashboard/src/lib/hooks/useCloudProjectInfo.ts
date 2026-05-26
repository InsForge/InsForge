import { useDashboardProject, useIsCloudHostingMode } from '#lib/config/DashboardHostContext';

export interface CloudProjectInfo {
  name?: string;
  latestVersion?: string;
  instanceType?: string;
  region?: string;
}

interface UseCloudProjectInfoOptions {
  enabled?: boolean;
  staleTime?: number;
  timeoutMs?: number;
}

export const CLOUD_PROJECT_INFO_QUERY_KEY = ['cloud-project-info'];

export function useCloudProjectInfo(_options?: UseCloudProjectInfoOptions) {
  const project = useDashboardProject();
  const isCloudHostingMode = useIsCloudHostingMode();
  const emptyProjectInfo: CloudProjectInfo = {};
  const hostProjectInfo: CloudProjectInfo = project
    ? {
        name: project.name,
        latestVersion: project.latestVersion ?? undefined,
        instanceType: project.instanceType,
        region: project.region,
      }
    : {};
  if (isCloudHostingMode) {
    return {
      projectInfo: hostProjectInfo,
      isLoading: false,
      error: null,
      refetch: () => Promise.resolve({ data: hostProjectInfo }),
    };
  }

  return {
    projectInfo: emptyProjectInfo,
    isLoading: false,
    error: null,
    refetch: () => Promise.resolve({ data: emptyProjectInfo }),
  };
}
