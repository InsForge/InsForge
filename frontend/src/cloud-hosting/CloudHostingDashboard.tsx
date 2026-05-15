import { InsForgeDashboard } from '@insforge/dashboard';
import { isInIframe } from '../helpers';
import { useCloudHosting } from './useCloudHosting';

export function CloudHostingDashboard() {
  const {
    getAuthorizationCode,
    projectInfo,
    reportRouteChange,
    showUpgradeDialog,
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
    requestAdvisorLatest,
    requestAdvisorIssues,
    triggerAdvisorScan,
    connectPosthog,
    subscribePosthogConnectionStatus,
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
      onRequestAdvisorLatest={requestAdvisorLatest}
      onRequestAdvisorIssues={requestAdvisorIssues}
      onTriggerAdvisorScan={triggerAdvisorScan}
      onConnectPosthog={connectPosthog}
      subscribePosthogConnectionStatus={subscribePosthogConnectionStatus}
    />
  );
}
