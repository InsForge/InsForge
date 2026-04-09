import { useCallback, useEffect, useRef, useState } from 'react';
import type { DashboardInstanceInfo, DashboardProjectInfo } from '@insforge/dashboard';

type InstanceTypeChangeResult = {
  success: boolean;
  instanceType?: string;
  error?: string;
};

type CloudHostingMessage = {
  type: string;
  [key: string]: unknown;
};

type PendingRequestKey =
  | 'authCode'
  | 'instanceInfo'
  | 'instanceTypeChange'
  | 'renameProject'
  | 'deleteProject'
  | 'updateVersion';

type PendingRequest<T> = {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timeoutId: number;
};

type PendingRequestValues = {
  authCode: string;
  instanceInfo: DashboardInstanceInfo;
  instanceTypeChange: InstanceTypeChangeResult;
  renameProject: void;
  deleteProject: void;
  updateVersion: void;
};

type PendingRequests = {
  [K in PendingRequestKey]?: PendingRequest<PendingRequestValues[K]>;
};

const DEFAULT_TIMEOUT_MS = 15000;
const INSTANCE_CHANGE_TIMEOUT_MS = 5 * 60 * 1000;
function normalizeUrl(url: string) {
  return url.replace(/\/$/, '');
}

function getParentWindow(): Window | null {
  if (typeof window === 'undefined' || window.parent === window) {
    return null;
  }

  return window.parent;
}

function getOpenerWindow(): Window | null {
  if (typeof window === 'undefined' || !window.opener || window.opener.closed) {
    return null;
  }

  return window.opener;
}

function getParentOrigin(): string | null {
  if (typeof window === 'undefined' || !getParentWindow() || !document.referrer) {
    return null;
  }

  try {
    return new URL(document.referrer).origin;
  } catch {
    return null;
  }
}

function getCurrentOrigin(): string {
  if (typeof window !== 'undefined') {
    return normalizeUrl(window.location.origin);
  }

  return '';
}

function getErrorMessage(message: unknown, fallback: string): string {
  return typeof message === 'string' && message.trim() ? message : fallback;
}

function normalizeProjectInfo(
  previous: DashboardProjectInfo | undefined,
  origin: string,
  message: CloudHostingMessage
): DashboardProjectInfo {
  const previousInfo = previous ?? {
    id: origin,
    name: 'Project',
    region: '',
    instanceType: '',
  };

  return {
    id: typeof message.id === 'string' && message.id ? message.id : previousInfo.id,
    name: typeof message.name === 'string' && message.name ? message.name : previousInfo.name,
    region:
      typeof message.region === 'string' && message.region ? message.region : previousInfo.region,
    instanceType:
      typeof message.instanceType === 'string' && message.instanceType
        ? message.instanceType
        : previousInfo.instanceType,
    latestVersion:
      typeof message.latestVersion === 'string' || message.latestVersion === null
        ? (message.latestVersion as string | null)
        : previousInfo.latestVersion,
    currentVersion:
      typeof message.currentVersion === 'string' || message.currentVersion === null
        ? (message.currentVersion as string | null)
        : previousInfo.currentVersion,
    status:
      typeof message.status === 'string' && message.status ? message.status : previousInfo.status,
  };
}

export function useCloudHosting() {
  const currentOrigin = getCurrentOrigin();
  const [projectInfo, setProjectInfo] = useState<DashboardProjectInfo>();
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);
  const queuedAuthorizationCodeRef = useRef<string | null>(null);
  const parentOriginRef = useRef<string | null>(getParentOrigin());
  const openerOriginRef = useRef<string | null>(null);
  const pendingRequestsRef = useRef<PendingRequests>({});

  const setPendingRequest = useCallback(
    <K extends PendingRequestKey>(
      key: K,
      pendingRequest: PendingRequest<PendingRequestValues[K]>
    ) => {
      switch (key) {
        case 'authCode':
          pendingRequestsRef.current.authCode = pendingRequest as PendingRequest<string>;
          return;
        case 'instanceInfo':
          pendingRequestsRef.current.instanceInfo =
            pendingRequest as PendingRequest<DashboardInstanceInfo>;
          return;
        case 'instanceTypeChange':
          pendingRequestsRef.current.instanceTypeChange =
            pendingRequest as PendingRequest<InstanceTypeChangeResult>;
          return;
        case 'renameProject':
          pendingRequestsRef.current.renameProject = pendingRequest as PendingRequest<void>;
          return;
        case 'deleteProject':
          pendingRequestsRef.current.deleteProject = pendingRequest as PendingRequest<void>;
          return;
        case 'updateVersion':
          pendingRequestsRef.current.updateVersion = pendingRequest as PendingRequest<void>;
          return;
      }
    },
    []
  );

  const clearPendingRequest = useCallback((key: PendingRequestKey) => {
    const pendingRequest = pendingRequestsRef.current[key];
    if (!pendingRequest) {
      return;
    }

    window.clearTimeout(pendingRequest.timeoutId);
    delete pendingRequestsRef.current[key];
  }, []);

  const rejectPendingRequest = useCallback(
    <K extends PendingRequestKey>(key: K, message: string) => {
      const pendingRequest = pendingRequestsRef.current[key];
      if (!pendingRequest) {
        return;
      }

      clearPendingRequest(key);
      pendingRequest.reject(new Error(message));
    },
    [clearPendingRequest]
  );

  const resolvePendingRequest = useCallback(
    <K extends PendingRequestKey>(key: K, value: PendingRequestValues[K]) => {
      const pendingRequest = pendingRequestsRef.current[key];
      if (!pendingRequest) {
        return;
      }

      clearPendingRequest(key);
      pendingRequest.resolve(value);
    },
    [clearPendingRequest]
  );

  const postMessageToParent = useCallback((message: CloudHostingMessage): boolean => {
    const parentWindow = getParentWindow();
    if (!parentWindow || !parentOriginRef.current) {
      return false;
    }

    parentWindow.postMessage(message, parentOriginRef.current);
    return true;
  }, []);

  const createPendingRequest = useCallback(
    <K extends PendingRequestKey>(key: K, actionLabel: string, timeoutMs = DEFAULT_TIMEOUT_MS) =>
      new Promise<PendingRequestValues[K]>((resolve, reject) => {
        if (pendingRequestsRef.current[key]) {
          reject(new Error(`${actionLabel} is already in progress`));
          return;
        }

        const timeoutId = window.setTimeout(() => {
          rejectPendingRequest(key, `${actionLabel} timed out`);
        }, timeoutMs);

        setPendingRequest(key, {
          resolve: resolve as (value: PendingRequestValues[K]) => void,
          reject: (error: Error) => reject(error),
          timeoutId,
        });
      }),
    [rejectPendingRequest, setPendingRequest]
  );

  useEffect(() => {
    const handleMessage = (event: MessageEvent<CloudHostingMessage>) => {
      const isParentMessage = event.source === getParentWindow();
      const isOpenerMessage = event.source === getOpenerWindow();

      if (!isParentMessage && !isOpenerMessage) {
        return;
      }

      if (isParentMessage) {
        if (!parentOriginRef.current) {
          parentOriginRef.current = event.origin;
        } else if (event.origin !== parentOriginRef.current) {
          return;
        }
      } else if (!openerOriginRef.current) {
        openerOriginRef.current = event.origin;
      } else if (event.origin !== openerOriginRef.current) {
        return;
      }

      const message = event.data;
      if (!message || typeof message !== 'object' || typeof message.type !== 'string') {
        return;
      }

      if (
        isOpenerMessage &&
        message.type !== 'AUTHORIZATION_CODE' &&
        message.type !== 'AUTHORIZATION_CODE_ERROR' &&
        message.type !== 'AUTH_ERROR'
      ) {
        return;
      }

      switch (message.type) {
        case 'SHOW_ONBOARDING_OVERLAY':
        case 'SHOW_CONNECT_OVERLAY': {
          setConnectDialogOpen(true);
          return;
        }
        case 'AUTHORIZATION_CODE': {
          const code =
            typeof message.code === 'string' && message.code.trim() ? message.code : null;

          if (!code) {
            rejectPendingRequest('authCode', 'Received an invalid authorization code');
            return;
          }

          if (pendingRequestsRef.current.authCode) {
            resolvePendingRequest('authCode', code);
            return;
          }

          queuedAuthorizationCodeRef.current = code;
          return;
        }
        case 'AUTHORIZATION_CODE_ERROR':
        case 'AUTH_ERROR': {
          rejectPendingRequest(
            'authCode',
            getErrorMessage(
              message.error ?? message.message,
              'Failed to generate authorization code'
            )
          );
          return;
        }
        case 'PROJECT_INFO': {
          setProjectInfo((previous) => normalizeProjectInfo(previous, currentOrigin, message));
          return;
        }
        case 'INSTANCE_INFO': {
          resolvePendingRequest('instanceInfo', {
            currentInstanceType:
              typeof message.currentInstanceType === 'string' ? message.currentInstanceType : '',
            planName: typeof message.planName === 'string' ? message.planName : '',
            computeCredits: typeof message.computeCredits === 'number' ? message.computeCredits : 0,
            currentOrgComputeCost:
              typeof message.currentOrgComputeCost === 'number' ? message.currentOrgComputeCost : 0,
            instanceTypes: Array.isArray(message.instanceTypes)
              ? (message.instanceTypes as DashboardInstanceInfo['instanceTypes'])
              : [],
            projects: Array.isArray(message.projects)
              ? (message.projects as DashboardInstanceInfo['projects'])
              : [],
          });
          return;
        }
        case 'INSTANCE_TYPE_CHANGE_RESULT': {
          resolvePendingRequest('instanceTypeChange', {
            success: Boolean(message.success),
            instanceType:
              typeof message.instanceType === 'string' ? message.instanceType : undefined,
            error: typeof message.error === 'string' ? message.error : undefined,
          });
          return;
        }
        case 'PROJECT_NAME_UPDATE_RESULT': {
          if (message.success === true) {
            if (typeof message.name === 'string' && message.name.trim()) {
              setProjectInfo((previous) =>
                normalizeProjectInfo(previous, currentOrigin, {
                  type: 'PROJECT_INFO',
                  name: message.name,
                })
              );
            }
            resolvePendingRequest('renameProject', undefined);
            return;
          }

          rejectPendingRequest(
            'renameProject',
            getErrorMessage(message.error, 'Failed to update project name')
          );
          return;
        }
        case 'DELETE_PROJECT_RESULT': {
          if (message.success === true) {
            resolvePendingRequest('deleteProject', undefined);
            return;
          }

          rejectPendingRequest(
            'deleteProject',
            getErrorMessage(message.error, 'Failed to delete project')
          );
          return;
        }
        case 'VERSION_UPDATE_STARTED': {
          resolvePendingRequest('updateVersion', undefined);
          return;
        }
        case 'VERSION_UPDATE_RESULT': {
          if (message.success === true) {
            resolvePendingRequest('updateVersion', undefined);
            return;
          }

          rejectPendingRequest(
            'updateVersion',
            getErrorMessage(message.error, 'Failed to update project version')
          );
          return;
        }
        default:
          return;
      }
    };

    const pendingRequests = pendingRequestsRef.current;

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);

      (Object.keys(pendingRequests) as PendingRequestKey[]).forEach((key) => {
        rejectPendingRequest(key, 'Cloud hosting was disposed');
      });
    };
  }, [currentOrigin, rejectPendingRequest, resolvePendingRequest]);

  useEffect(() => {
    void postMessageToParent({ type: 'REQUEST_PROJECT_INFO' });
  }, [postMessageToParent]);

  const getAuthorizationCode = useCallback(async (): Promise<string> => {
    if (queuedAuthorizationCodeRef.current) {
      const code = queuedAuthorizationCodeRef.current;
      queuedAuthorizationCodeRef.current = null;
      return code;
    }

    // Even if the send fails, keep the pending request open so a proactive parent or opener
    // message can still resolve it when the cloud hosting transport finishes initializing.
    postMessageToParent({ type: 'REQUEST_AUTHORIZATION_CODE' });

    return createPendingRequest('authCode', 'Authorization code request');
  }, [createPendingRequest, postMessageToParent]);

  const requestInstanceInfo = useCallback(async (): Promise<DashboardInstanceInfo> => {
    if (!postMessageToParent({ type: 'REQUEST_INSTANCE_INFO' })) {
      throw new Error('Unable to request instance information from the parent window');
    }

    return createPendingRequest('instanceInfo', 'Instance info request');
  }, [createPendingRequest, postMessageToParent]);

  const requestInstanceTypeChange = useCallback(
    async (instanceType: string): Promise<InstanceTypeChangeResult> => {
      if (!postMessageToParent({ type: 'REQUEST_INSTANCE_TYPE_CHANGE', instanceType })) {
        throw new Error('Unable to request an instance type change from the parent window');
      }

      return createPendingRequest(
        'instanceTypeChange',
        'Instance type change',
        INSTANCE_CHANGE_TIMEOUT_MS
      );
    },
    [createPendingRequest, postMessageToParent]
  );

  const renameProject = useCallback(
    async (name: string): Promise<void> => {
      if (!postMessageToParent({ type: 'UPDATE_PROJECT_NAME', name })) {
        throw new Error('Unable to request a project rename from the parent window');
      }

      return createPendingRequest('renameProject', 'Project rename');
    },
    [createPendingRequest, postMessageToParent]
  );

  const deleteProject = useCallback(async (): Promise<void> => {
    if (!postMessageToParent({ type: 'DELETE_PROJECT' })) {
      throw new Error('Unable to request project deletion from the parent window');
    }

    return createPendingRequest('deleteProject', 'Project deletion');
  }, [createPendingRequest, postMessageToParent]);

  const updateVersion = useCallback(async (): Promise<void> => {
    if (!postMessageToParent({ type: 'UPDATE_PROJECT_VERSION' })) {
      throw new Error('Unable to request a project version update from the parent window');
    }

    return createPendingRequest('updateVersion', 'Project version update');
  }, [createPendingRequest, postMessageToParent]);

  const navigateToSubscription = useCallback(() => {
    void postMessageToParent({ type: 'NAVIGATE_TO_SUBSCRIPTION' });
  }, [postMessageToParent]);

  return {
    connectDialogOpen,
    setConnectDialogOpen,
    projectInfo,
    getAuthorizationCode,
    requestInstanceInfo,
    requestInstanceTypeChange,
    renameProject,
    deleteProject,
    updateVersion,
    navigateToSubscription,
  };
}
