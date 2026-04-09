import { InsForgeDashboard } from '@insforge/dashboard';
import { isInIframe } from '../helpers';
import { useCloudHosting } from './useCloudHosting';

export function CloudHostingDashboard() {
  const {
    connectDialogOpen,
    setConnectDialogOpen,
    getAuthorizationCode,
    projectInfo,
    navigateToSubscription,
    renameProject,
    deleteProject,
    requestInstanceInfo,
    requestInstanceTypeChange,
    updateVersion,
  } = useCloudHosting();

  return (
    <InsForgeDashboard
      mode="cloud-hosting"
      showNavbar={!isInIframe()}
      connectDialogOpen={connectDialogOpen}
      onConnectDialogOpenChange={setConnectDialogOpen}
      getAuthorizationCode={getAuthorizationCode}
      project={projectInfo}
      onNavigateToSubscription={navigateToSubscription}
      onRenameProject={renameProject}
      onDeleteProject={deleteProject}
      onRequestInstanceInfo={requestInstanceInfo}
      onRequestInstanceTypeChange={requestInstanceTypeChange}
      onUpdateVersion={updateVersion}
    />
  );
}
