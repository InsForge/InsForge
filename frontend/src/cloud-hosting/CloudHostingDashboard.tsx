import { InsForgeDashboard } from '@insforge/dashboard';
import { useCloudHosting } from './useCloudHosting';

export function CloudHostingDashboard() {
  const {
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
      showNavbar={false}
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
