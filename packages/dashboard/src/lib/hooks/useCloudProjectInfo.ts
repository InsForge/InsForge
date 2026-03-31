import { useDashboardHost } from '../config/DashboardHostContext';

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

export function useCloudProjectInfo(options?: UseCloudProjectInfoOptions) {
  const host = useDashboardHost();
  const emptyProjectInfo: CloudProjectInfo = {};
  const hostProjectInfo: CloudProjectInfo = host.project
    ? {
        name: host.project.name,
        latestVersion: host.project.latestVersion ?? undefined,
        instanceType: host.project.instanceType,
        region: host.project.region,
      }
    : {};
  if (host.mode === 'cloud-hosting') {
    return {
      projectInfo: hostProjectInfo,
      isLoading: false,
      error: null,
      refetch: async () => ({ data: hostProjectInfo }),
    };
  }

  return {
    projectInfo: emptyProjectInfo,
    isLoading: false,
    error: null,
    refetch: async () => ({ data: emptyProjectInfo }),
  };
}
