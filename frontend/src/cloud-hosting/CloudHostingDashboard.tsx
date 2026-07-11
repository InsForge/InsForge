import { InsForgeDashboard } from '@insforge/dashboard';
import { isInIframe } from '../helpers';
import { useCloudHosting } from './useCloudHosting';

export function CloudHostingDashboard() {
  const {
    getAuthorizationCode,
    projectInfo,
    reportRouteChange,
    showUpgradeDialog,
    openWhatsNew,
    renameProject,
    deleteProject,
    requestBackupInfo,
    createBackup,
    deleteBackup,
    renameBackup,
    restoreBackup,
    requestInstanceInfo,
    requestInstanceTypeChange,
    updateVersion,
    requestUserInfo,
    requestUserApiKey,
    requestModelCredits,
    requestProjectMetrics,
    connectPosthog,
    openPosthog,
    subscribePosthogConnectionStatus,
    connectApify,
    subscribeApifyConnectionStatus,
  } = useCloudHosting();

  return (
    <InsForgeDashboard
      mode="cloud-hosting"
      showNavbar={!isInIframe()}
      getAuthorizationCode={getAuthorizationCode}
      useAuthorizationCodeRefresh={isInIframe()}
      project={projectInfo}
      onRouteChange={reportRouteChange}
      onShowUpgradeDialog={showUpgradeDialog}
      onOpenWhatsNew={openWhatsNew}
      onRenameProject={renameProject}
      onDeleteProject={deleteProject}
      onRequestBackupInfo={requestBackupInfo}
      onCreateBackup={createBackup}
      onDeleteBackup={deleteBackup}
      onRenameBackup={renameBackup}
      onRestoreBackup={restoreBackup}
      onRequestInstanceInfo={requestInstanceInfo}
      onRequestInstanceTypeChange={requestInstanceTypeChange}
      onUpdateVersion={updateVersion}
      onRequestUserInfo={requestUserInfo}
      onRequestUserApiKey={requestUserApiKey}
      onRequestModelCredits={requestModelCredits}
      onRequestProjectMetrics={requestProjectMetrics}
      onConnectPosthog={connectPosthog}
      onOpenPosthog={openPosthog}
      subscribePosthogConnectionStatus={subscribePosthogConnectionStatus}
      onConnectApify={connectApify}
      subscribeApifyConnectionStatus={subscribeApifyConnectionStatus}
    />
  );
}
