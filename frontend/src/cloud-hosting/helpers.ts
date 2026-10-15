import type { DashboardProjectInfo } from '@insforge/dashboard';

/**
 * Pure helpers for the cloud-hosting postMessage bridge.
 *
 * These live apart from `useCloudHosting` so they can be imported without
 * pulling in React or `partner.service`, which is what a node test runner
 * needs. Keep this module free of runtime imports.
 */

export type CloudHostingMessage = {
  type: string;
  [key: string]: unknown;
};

/** The message's own error text when it has usable one, else the fallback. */
export function getErrorMessage(message: unknown, fallback: string): string {
  return typeof message === 'string' && message.trim() ? message : fallback;
}

/**
 * Folds a PROJECT_INFO message onto whatever is already known.
 *
 * Every field falls back to the previous value, so a partial message never
 * blanks out state that an earlier message established.
 */
export function normalizeProjectInfo(
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
    isBranch: typeof message.isBranch === 'boolean' ? message.isBranch : previousInfo.isBranch,
  };
}
