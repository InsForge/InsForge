import { useQuery } from '@tanstack/react-query';
import { isIframe, isInsForgeCloudProject } from '@/lib/utils/utils';
import { parseCloudEvent, postMessageToParent } from '@/lib/utils/cloudMessaging';

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

function requestCloudProjectInfo(timeoutMs: number): Promise<CloudProjectInfo> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve({});
      return;
    }

    let settled = false;
    const finalize = () => {
      if (settled) {
        return;
      }
      settled = true;

      window.removeEventListener('message', handleMessage);
      clearTimeout(timeoutTimer);
      resolve({});
    };

    const handleMessage = (event: MessageEvent) => {
      const parsed = parseCloudEvent(event.data);
      if (!parsed.ok || parsed.data.type !== 'PROJECT_INFO') {
        return;
      }

      settled = true;
      window.removeEventListener('message', handleMessage);
      clearTimeout(timeoutTimer);
      resolve({
        name: parsed.data.name,
        latestVersion: parsed.data.latestVersion,
        instanceType: parsed.data.instanceType,
        region: parsed.data.region,
      });
    };

    window.addEventListener('message', handleMessage);

    // Standard contract: request project metadata with REQUEST_PROJECT_INFO,
    // cloud host responds with PROJECT_INFO.
    postMessageToParent({ type: 'REQUEST_PROJECT_INFO' }, '*');

    const timeoutTimer = setTimeout(finalize, timeoutMs);
  });
}

export function useCloudProjectInfo(options?: UseCloudProjectInfoOptions) {
  const shouldFetchFromCloud = (options?.enabled ?? true) && isInsForgeCloudProject() && isIframe();

  const {
    data: projectInfo = {},
    isLoading,
    error,
    refetch,
  } = useQuery<CloudProjectInfo>({
    queryKey: CLOUD_PROJECT_INFO_QUERY_KEY,
    queryFn: () => requestCloudProjectInfo(options?.timeoutMs ?? 1500),
    enabled: shouldFetchFromCloud,
    staleTime: options?.staleTime ?? 10 * 60 * 1000, // 10 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
    refetchOnWindowFocus: false,
  });

  return {
    projectInfo,
    isLoading,
    error,
    refetch,
  };
}
