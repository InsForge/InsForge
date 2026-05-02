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
    createBackup,
    deleteBackup,
    renameBackup,
    restoreBackup,
    requestInstanceInfo,
    requestInstanceTypeChange,
    updateVersion,
    requestUserInfo,
    requestUserApiKey,
    requestProjectMetrics,
    requestAdvisorLatest,
    requestAdvisorIssues,
    triggerAdvisorScan,
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
      onCreateBackup={createBackup}
      onDeleteBackup={deleteBackup}
      onRenameBackup={renameBackup}
      onRestoreBackup={restoreBackup}
      onRequestInstanceInfo={requestInstanceInfo}
      onRequestInstanceTypeChange={requestInstanceTypeChange}
      onUpdateVersion={updateVersion}
      onRequestUserInfo={requestUserInfo}
      onRequestUserApiKey={requestUserApiKey}
      onRequestProjectMetrics={requestProjectMetrics}
      onRequestAdvisorLatest={requestAdvisorLatest}
      onRequestAdvisorIssues={requestAdvisorIssues}
      onTriggerAdvisorScan={triggerAdvisorScan}
    />
  );
}
