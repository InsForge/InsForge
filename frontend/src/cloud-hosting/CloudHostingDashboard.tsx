import { InsForgeDashboard } from '@insforge/dashboard';
import { isInIframe } from '../helpers';
import { useCloudHosting } from './useCloudHosting';

export function CloudHostingDashboard() {
  const {
    getAuthorizationCode,
    projectInfo,
    reportRouteChange,
    navigateToSubscription,
    renameProject,
    deleteProject,
    requestBackupInfo,
    renameBackup,
    restoreBackup,
    requestInstanceInfo,
    requestInstanceTypeChange,
    updateVersion,
    requestUserInfo,
  } = useCloudHosting();

  return (
    <InsForgeDashboard
      mode="cloud-hosting"
      showNavbar={!isInIframe()}
      getAuthorizationCode={getAuthorizationCode}
      useAuthorizationCodeRefresh={isInIframe()}
      project={projectInfo}
      onRouteChange={reportRouteChange}
      onNavigateToSubscription={navigateToSubscription}
      onRenameProject={renameProject}
      onDeleteProject={deleteProject}
      onRequestBackupInfo={requestBackupInfo}
      onRenameBackup={renameBackup}
      onRestoreBackup={restoreBackup}
      onRequestInstanceInfo={requestInstanceInfo}
      onRequestInstanceTypeChange={requestInstanceTypeChange}
      onUpdateVersion={updateVersion}
      onRequestUserInfo={requestUserInfo}
    />
  );
}
